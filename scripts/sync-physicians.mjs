#!/usr/bin/env node
// Usage: node scripts/sync-physicians.mjs [--apply] [--allow-mass-deactivate] <roster.csv|->
//        (or: npm run sync-physicians -- ...)
// Makes the database table physicians (who may sign in, and their names for the sign-in alert) match a roster CSV:
// UTF-8, header email,name,dept, one row per email (alternate addresses are extra rows with the same name).
// Prints what changes: added, changed (name or dept), reactivated, deactivated (active rows missing from the CSV),
// and which emails off the roster still sign in through an approved access request (revoking those stays manual).
// Writes only with --apply, in one transaction, and never deletes a row: a removed physician is deactivated, so the
// alert still names them. --apply refuses to deactivate more than 5 rows and more than 10% of the active ones at
// once (a partial CSV?) unless --allow-mass-deactivate. The app sees the change within 60 s, no redeploy.
// The CSV holds physician emails: it must live OUTSIDE the repository ("-" reads stdin). DATABASE_URL comes from
// env or .env.local. A missing table is created from db/schema.sql (as lib/db.ts does) before the sync.
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import pg from "pg";
import { loadEnvLocal, repoRoot } from "./load-env.mjs";
import {
  diffRoster,
  formatDiff,
  formatStillApproved,
  isEmptyDiff,
  isMassDeactivation,
  offRoster,
  parseRoster,
} from "./physicians-roster.mjs";

const USAGE = "usage: node scripts/sync-physicians.mjs [--apply] [--allow-mass-deactivate] <roster.csv|->";
const FLAGS = new Set(["--apply", "--allow-mass-deactivate"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", ""]);

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const allowMass = args.includes("--allow-mass-deactivate");
const rest = args.filter((a) => !FLAGS.has(a));
if (rest.length !== 1 || (rest[0].startsWith("-") && rest[0] !== "-")) fail(USAGE, 2);
const input = rest[0];

/** The CSV as text: refuses a file inside the repository and anything that is not UTF-8. */
function readRoster() {
  let bytes;
  if (input === "-") {
    bytes = readFileSync(0);
  } else {
    let file;
    try {
      file = realpathSync(resolve(input));
    } catch (e) {
      fail(`cannot read ${input}: ${e.code ?? e.message}`);
    }
    const rel = relative(realpathSync(repoRoot), file);
    if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
      fail("the CSV must live outside the repository (it holds physician emails)");
    }
    try {
      bytes = readFileSync(file);
    } catch (e) {
      fail(`cannot read ${input}: ${e.code ?? e.message}`);
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${input} is not UTF-8 text (in Excel: Save As "CSV UTF-8")`);
  }
}

/** As createPool() in lib/db.ts: TLS with certificate verification for any non-local host (e.g. Neon). */
function client(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    // never echo the value: it holds the password
    fail("DATABASE_URL is not a valid URL (set it in env or .env.local)");
  }
  for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat", "channel_binding"]) {
    u.searchParams.delete(k);
  }
  const c = new pg.Client({
    connectionString: u.toString(),
    connectionTimeoutMillis: 10_000,
    ssl: LOCAL_HOSTS.has(u.hostname) ? false : { rejectUnauthorized: true },
  });
  // where the changes go, without credentials
  return { c, target: `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}` };
}

/** True when the table exists. */
async function hasTable(c, name) {
  const { rows } = await c.query("SELECT to_regclass($1) IS NOT NULL AS present", [name]);
  return rows[0].present;
}

/** Every row of the table, or null when it does not exist yet. */
async function currentRows(c) {
  if (!(await hasTable(c, "physicians"))) return null;
  return (await c.query("SELECT email, name, dept, active FROM physicians ORDER BY email")).rows;
}

/** Those of `emails` with an approved access request (lib/authz.ts authorizes them without an active row). */
async function stillApproved(c, emails) {
  if (!emails.length || !(await hasTable(c, "access_requests"))) return [];
  const { rows } = await c.query(
    "SELECT DISTINCT email FROM access_requests WHERE status = 'approved' AND email = ANY($1) ORDER BY email",
    [emails],
  );
  return rows.map((r) => r.email);
}

const { entries, errors } = parseRoster(readRoster());
if (errors.length) {
  for (const e of errors) console.error(e);
  fail(`${errors.length} problem(s) in ${input === "-" ? "stdin" : input}; nothing was written`);
}

const url = loadEnvLocal().DATABASE_URL ?? "";
if (!/^postgres(ql)?:\/\//.test(url)) fail("DATABASE_URL is missing or not a postgres:// URL (set it in env or .env.local)");
const { c, target } = client(url);

try {
  await c.connect();
  console.log(`database ${target}; CSV: ${entries.length} emails, ${new Set(entries.map((e) => e.name)).size} names`);
  const massNote = (diff, current) =>
    `deactivates ${diff.deactivated.length} of ${current.filter((r) => r.active).length} active physicians at once ` +
    "(a partial CSV?): check the list above, then add --allow-mass-deactivate if it is right";
  if (!apply) {
    const rows = await currentRows(c);
    if (!rows) console.log("table physicians does not exist yet (--apply creates it from db/schema.sql)");
    const current = rows ?? [];
    const diff = diffRoster(current, entries);
    for (const l of formatDiff(diff)) console.log(l);
    for (const l of formatStillApproved(await stillApproved(c, offRoster(current, entries)))) console.log(l);
    if (!allowMass && isMassDeactivation(diff, current)) console.log(`--apply will refuse this: it ${massNote(diff, current)}`);
    console.log(isEmptyDiff(diff) ? "nothing to change" : "dry run: nothing was written; run again with --apply to write these changes");
  } else {
    // Missing tables first, exactly as ensureSchema() in lib/db.ts (its own short transaction, same lock).
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext('orskh:schema'))");
    await c.query(readFileSync(join(repoRoot, "db", "schema.sql"), "utf8"));
    await c.query("COMMIT");

    await c.query("BEGIN");
    // Other writers (another sync, a manual UPDATE) wait until this commits; sign-ins keep reading the table.
    await c.query("LOCK TABLE physicians IN SHARE ROW EXCLUSIVE MODE");
    const current = await currentRows(c);
    const diff = diffRoster(current, entries);
    for (const l of formatDiff(diff)) console.log(l);
    if (!allowMass && isMassDeactivation(diff, current)) {
      await c.query("ROLLBACK");
      console.error(`refused, nothing was written: this ${massNote(diff, current)}`);
      process.exitCode = 1;
    } else {
      for (const e of diff.added) {
        await c.query("INSERT INTO physicians (email, name, dept) VALUES ($1, $2, $3)", [e.email, e.name, e.dept]);
      }
      for (const e of [...diff.changed, ...diff.reactivated]) {
        await c.query("UPDATE physicians SET name = $2, dept = $3, active = true, updated_at = now() WHERE email = $1", [
          e.email,
          e.name,
          e.dept,
        ]);
      }
      for (const r of diff.deactivated) {
        await c.query("UPDATE physicians SET active = false, updated_at = now() WHERE email = $1", [r.email]);
      }
      const approved = await stillApproved(c, offRoster(current, entries));
      await c.query("COMMIT");
      console.log(isEmptyDiff(diff) ? "nothing to change" : "applied (the site sees it within 60 s)");
      for (const l of formatStillApproved(approved)) console.log(l);
    }
  }
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error(`sync failed, the roster was not changed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end().catch(() => {});
}
