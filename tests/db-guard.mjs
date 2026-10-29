// Guard for the test databases. The unit tests (tests/unit/_setup.ts, TEST_DATABASE_URL) and the e2e run
// (tests/e2e/run.mjs, E2E_DATABASE_URL) drop and truncate tables, users and user_claims among them. In production,
// users is shared: another workstream owns it, loads it and promises stable ids. A test database URL that points to Neon,
// or to a Neon branch of production, would destroy it. So the tests refuse to start unless:
//   1. the database host is local (localhost, 127.0.0.1, ::1 or a Unix socket), unless ALLOW_REMOTE_TEST_DB=1 is set
//      (only for a remote database that holds nothing you need), and
//   2. users, when it exists, holds no more than MAX_TEST_USERS rows (the tests insert far fewer; production holds
//      about 200). This check runs even with ALLOW_REMOTE_TEST_DB=1.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
/** More rows than any test inserts into users. A table holding more is real data, not a leftover from a test run. */
export const MAX_TEST_USERS = 50;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// node-postgres's own parser (resolved from pg, which depends on it), so the guard reads a URL exactly as pg does
const requireFromPg = createRequire(createRequire(import.meta.url).resolve("pg"));
const { parse: parsePgUrl } = requireFromPg("pg-connection-string");

/**
 * The host(s) node-postgres connects to for this URL, read with pg's parser (a `host` query parameter wins over the
 * URL's host, a %2F-encoded host is a socket directory), then PGHOST, then localhost (pg's default). Throws on a string
 * that is not a postgres URL or socket path.
 */
export function databaseHosts(url, env = process.env) {
  if (!/^(postgres(ql)?:\/\/|socket:|\/)/i.test(url ?? "")) throw new Error("expected postgres://, postgresql://, socket: or a socket path");
  let config;
  try {
    config = parsePgUrl(url);
  } catch {
    throw new Error("it does not parse"); // pg's error would echo the URL, password included
  }
  const host = config.host || env.PGHOST || "localhost";
  return host.split(",").map((h) => h.trim().replace(/^\[(.*)\]$/, "$1").toLowerCase());
}

/** True for a loopback host name or address, or a Unix socket directory (an absolute path). */
export function isLocalHost(host) {
  return LOCAL_HOSTS.has(host) || host.startsWith("/");
}

/** Throws unless every host of `url` is local, or ALLOW_REMOTE_TEST_DB=1. `varName` names the setting in the message. */
export function assertLocalTestDatabase(url, varName, env = process.env) {
  let hosts;
  try {
    hosts = databaseHosts(url, env);
  } catch (e) {
    throw new Error(`Refusing to run the tests: ${varName} is not a valid postgres URL (${e.message}).`);
  }
  const remote = hosts.filter((h) => !isLocalHost(h));
  if (remote.length === 0 || env.ALLOW_REMOTE_TEST_DB === "1") return;
  throw new Error(
    `Refusing to run the tests: ${varName} points to ${remote.join(", ")}, not to localhost. The tests drop and ` +
      "truncate tables, the shared users table among them. Point it at a local database, or set " +
      "ALLOW_REMOTE_TEST_DB=1 if that remote database holds nothing you need.",
  );
}

function tooManyUsers(varName, n) {
  return new Error(
    `Refusing to run the tests: users in the database of ${varName} holds ${n} rows, more than the tests ever insert ` +
      `(${MAX_TEST_USERS}). It looks like real data. Use an empty test database.`,
  );
}

/** Rows in public.users, or 0 when the table does not exist. `query` is pg's Pool/Client query. */
export async function countUsers(query) {
  const exists = await query("SELECT to_regclass('public.users') IS NOT NULL AS e");
  if (!exists.rows[0].e) return 0;
  return Number((await query("SELECT count(*)::int AS n FROM users")).rows[0].n);
}

/** Throws when users holds more than MAX_TEST_USERS rows. Call before the first DROP or TRUNCATE. */
export async function assertDisposableUsers(query, varName) {
  const n = await countUsers(query);
  if (n > MAX_TEST_USERS) throw tooManyUsers(varName, n);
}

/**
 * Synchronous form of assertDisposableUsers for module set-up code (tests/unit/_setup.ts runs before any test and
 * cannot await). It counts in a child process. A database that cannot be reached is let through: the tests that need
 * it fail on their own, and the tests that do not need it still run.
 */
export function assertDisposableUsersSync(url, varName) {
  const script = `
    const pg = require("pg");
    const c = new pg.Client({ connectionString: process.env.GUARD_DB_URL, connectionTimeoutMillis: 5000 });
    (async () => {
      let out = "?";
      try {
        await c.connect();
        const e = await c.query("SELECT to_regclass('public.users') IS NOT NULL AS e");
        out = e.rows[0].e ? String((await c.query("SELECT count(*)::int AS n FROM users")).rows[0].n) : "0";
      } catch {}
      await c.end().catch(() => {});
      process.stdout.write(out);
    })();
  `;
  const out = execFileSync(process.execPath, ["-e", script], {
    cwd: REPO_ROOT,
    env: { ...process.env, GUARD_DB_URL: url },
    encoding: "utf8",
    timeout: 20_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (/^\d+$/.test(out) && Number(out) > MAX_TEST_USERS) throw tooManyUsers(varName, Number(out));
}
