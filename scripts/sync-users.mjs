#!/usr/bin/env node
// Usage: node scripts/sync-users.mjs [--apply] [--allow-mass-deactivate] <all-users.csv|->
//        (or: npm run sync-users -- ...)
// Makes the database table users (shared with the rest of the project; the names people claim on /login/claim) match
// Pong's list: a CSV in UTF-8 (a BOM is fine) with the header first_name,last_name,type,subtype; type is DR, RN, PN or
// PCA, subtype a code (ORTHO, OR, ANES, ...) and required (users.subtype is NOT NULL). A row is one person, keyed by
// (first_name, last_name), the table's unique constraint, after the names are cleaned (NFC, single spaces, invisible
// characters removed); a person whose type changes keeps their row, with the new type and subtype. Prints counts per
// type and what changes: added, changed (type or subtype), reactivated, deactivated (active rows missing from the
// CSV), and which deactivated names hold a current claim (those numbers stop signing in). Writes only with --apply, in
// one transaction. It never deletes a row, never sets an id (users.id is an identity column, so ids stay stable), sets
// updated_at = now() on every row it changes, and never touches user_claims (a claim survives a sync; a deactivated
// claimed name stops authorizing, and authorizes again when it comes back). --apply refuses to deactivate more than 5
// rows and more than 10% of the active ones at once (a partial CSV?) unless --allow-mass-deactivate. The app sees the
// change within 60 s. This script is the only writer of users on the sign-in side; the app only reads it.
// The CSV holds names: it must live OUTSIDE the repository ("-" reads stdin). DATABASE_URL comes from env or
// .env.local. Missing tables are created from db/schema.sql (as lib/db.ts does) before the sync; where users already
// exists (production) that statement is a no-op.
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import pg from "pg";
import { loadEnvLocal, repoRoot } from "./load-env.mjs";
import {
  diffRoster,
  formatClaimedOff,
  formatDiff,
  formatSummary,
  isEmptyDiff,
  isMassDeactivation,
  parseRoster,
} from "./users-roster.mjs";

const USAGE = "usage: node scripts/sync-users.mjs [--apply] [--allow-mass-deactivate] <all-users.csv|->";
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
      fail("the CSV must live outside the repository (it holds real names)");
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

/**
 * Every row of the table, with whether it holds a current claim (never the number or the LINE id), or null when the
 * table does not exist yet.
 */
async function currentRows(c) {
  if (!(await hasTable(c, "users"))) return null;
  const claimed = (await hasTable(c, "user_claims"))
    ? "EXISTS (SELECT 1 FROM user_claims c WHERE c.user_id = u.id AND c.undone_at IS NULL)"
    : "false";
  const { rows } = await c.query(
    `SELECT u.id::text AS id, u.first_name, u.last_name, u.type, u.subtype, u.active, ${claimed} AS claimed
     FROM users u ORDER BY u.id`,
  );
  return rows;
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
  console.log(`database ${target}`);
  const massNote = (diff, current) =>
    `deactivates ${diff.deactivated.length} of ${current.filter((r) => r.active).length} active names at once ` +
    "(a partial CSV?): check the list above, then add --allow-mass-deactivate if it is right";
  if (!apply) {
    const rows = await currentRows(c);
    if (!rows) console.log("table users does not exist yet (--apply creates it from db/schema.sql)");
    const current = rows ?? [];
    const diff = diffRoster(current, entries);
    for (const l of formatDiff(diff)) console.log(l);
    for (const l of formatSummary(entries, diff)) console.log(l);
    for (const l of formatClaimedOff(diff)) console.log(l);
    if (!allowMass && isMassDeactivation(diff, current)) console.log(`--apply will refuse this: it ${massNote(diff, current)}`);
    console.log(isEmptyDiff(diff) ? "nothing to change" : "dry run: nothing was written; run again with --apply to write these changes");
  } else {
    // Missing tables first, exactly as ensureSchema() in lib/db.ts (its own short transaction, same lock).
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext('orskh:schema'))");
    await c.query(readFileSync(join(repoRoot, "db", "schema.sql"), "utf8"));
    await c.query("COMMIT");

    await c.query("BEGIN");
    // Other writers (another sync, a manual UPDATE) wait until this commits; sign-ins and claims keep reading the table.
    await c.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
    const current = await currentRows(c);
    const diff = diffRoster(current, entries);
    for (const l of formatDiff(diff)) console.log(l);
    for (const l of formatSummary(entries, diff)) console.log(l);
    if (!allowMass && isMassDeactivation(diff, current)) {
      await c.query("ROLLBACK");
      console.error(`refused, nothing was written: this ${massNote(diff, current)}`);
      process.exitCode = 1;
    } else {
      // id is GENERATED ALWAYS: never given, so the table numbers new rows itself.
      for (const e of diff.added) {
        await c.query("INSERT INTO users (first_name, last_name, type, subtype) VALUES ($1, $2, $3, $4)", [
          e.firstName,
          e.lastName,
          e.type,
          e.subtype,
        ]);
      }
      // Only type, subtype and active (the row keeps its id and names; claims in user_claims stay as they are).
      for (const e of [...diff.changed, ...diff.reactivated]) {
        await c.query("UPDATE users SET type = $2, subtype = $3, active = true, updated_at = now() WHERE id = $1", [
          e.before.id,
          e.type,
          e.subtype,
        ]);
      }
      for (const r of diff.deactivated) {
        await c.query("UPDATE users SET active = false, updated_at = now() WHERE id = $1", [r.id]);
      }
      await c.query("COMMIT");
      console.log(isEmptyDiff(diff) ? "nothing to change" : "applied (the site sees it within 60 s)");
      for (const l of formatClaimedOff(diff)) console.log(l);
    }
  }
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error(`sync failed, the users table was not changed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end().catch(() => {});
}
