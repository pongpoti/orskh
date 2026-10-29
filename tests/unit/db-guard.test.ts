import "./_setup";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import {
  assertDisposableUsers,
  assertDisposableUsersSync,
  assertLocalTestDatabase,
  countUsers,
  databaseHosts,
  isLocalHost,
  MAX_TEST_USERS,
} from "../db-guard.mjs";
import { TEST_DB } from "./_setup";

// The Neon-like host is invented; nothing connects to it.
const REMOTE = "postgres://u:secret-pw@ep-invented-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full";
const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;
const NO_ENV = env({});

describe("test database guard: host", () => {
  test("local hosts pass", () => {
    for (const url of [
      "postgres://postgres:postgres@localhost:5432/orskh_test",
      "postgresql://postgres@127.0.0.1/orskh_test",
      "postgres://postgres@[::1]:5432/orskh_test",
      "postgres://postgres@LOCALHOST/orskh_test",
      "postgres:///orskh_test",
      "postgres://postgres@/orskh_test?host=/var/run/postgresql",
      "postgres://postgres@%2Fvar%2Frun%2Fpostgresql/orskh_test",
    ]) {
      assert.doesNotThrow(() => assertLocalTestDatabase(url, "TEST_DATABASE_URL", NO_ENV), url);
    }
  });

  test("a remote host is refused, without the password in the message", () => {
    assert.throws(
      () => assertLocalTestDatabase(REMOTE, "TEST_DATABASE_URL", NO_ENV),
      (e: Error) =>
        /TEST_DATABASE_URL points to ep-invented-123\.ap-southeast-1\.aws\.neon\.tech/.test(e.message) &&
        /ALLOW_REMOTE_TEST_DB=1/.test(e.message) &&
        !e.message.includes("secret-pw"),
    );
  });

  test("every way of naming a remote host is refused", () => {
    for (const url of [
      "postgres://u@db.example.com/x",
      "postgres://u@10.0.0.5/x",
      "postgres://u@localhost.example.com/x",
      "postgres://u@127.0.0.2.nip.io/x",
      "postgres://u@localhost/x?host=db.example.com", // the host parameter wins in node-postgres
      "postgres://u@/x?host=localhost,db.example.com",
    ]) {
      assert.throws(() => assertLocalTestDatabase(url, "E2E_DATABASE_URL", NO_ENV), /E2E_DATABASE_URL points to/, url);
    }
    // no host in the URL: PGHOST decides, as in node-postgres
    assert.throws(() => assertLocalTestDatabase("postgres:///x", "TEST_DATABASE_URL", env({ PGHOST: "db.example.com" })), /points to db\.example\.com/);
    assert.doesNotThrow(() => assertLocalTestDatabase("postgres:///x", "TEST_DATABASE_URL", env({ PGHOST: "/tmp" })));
  });

  test("a URL that does not parse, or is not postgres, is refused", () => {
    for (const url of ["not a url", "", "mysql://u@localhost/x", "http://localhost/x"]) {
      assert.throws(() => assertLocalTestDatabase(url, "TEST_DATABASE_URL", NO_ENV), /not a valid postgres URL/, url);
    }
  });

  test("ALLOW_REMOTE_TEST_DB=1 (exactly) lets a remote host through", () => {
    assert.doesNotThrow(() => assertLocalTestDatabase(REMOTE, "TEST_DATABASE_URL", env({ ALLOW_REMOTE_TEST_DB: "1" })));
    for (const v of ["", "0", "true", "yes"]) {
      assert.throws(() => assertLocalTestDatabase(REMOTE, "TEST_DATABASE_URL", env({ ALLOW_REMOTE_TEST_DB: v })), /points to/, v);
    }
  });

  test("databaseHosts and isLocalHost", () => {
    assert.deepEqual(databaseHosts("postgres://u@[::1]/x", NO_ENV), ["::1"]);
    assert.deepEqual(databaseHosts("postgres://u@/x?host=a,b", NO_ENV), ["a", "b"]);
    assert.deepEqual(databaseHosts("postgres:///x", NO_ENV), ["localhost"]);
    assert.ok(isLocalHost("/var/run/postgresql"));
    assert.ok(!isLocalHost("0.0.0.0"));
  });

  test("importing the unit test set-up with a remote TEST_DATABASE_URL stops before any test", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "-e", "import('./tests/unit/_setup.ts')"], {
      env: { ...process.env, TEST_DATABASE_URL: REMOTE, ALLOW_REMOTE_TEST_DB: "" },
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /Refusing to run the tests: TEST_DATABASE_URL points to ep-invented-123/);
  });

  test("the e2e run with a remote E2E_DATABASE_URL stops before it builds or connects", () => {
    const r = spawnSync(process.execPath, ["tests/e2e/run.mjs"], {
      env: { ...process.env, E2E_DATABASE_URL: REMOTE, ALLOW_REMOTE_TEST_DB: "", E2E_SKIP_BUILD: "1" },
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /Refusing to run the tests: E2E_DATABASE_URL points to ep-invented-123/);
    assert.ok(!r.stdout.includes("[e2e] app"), r.stdout);
  });
});

describe("test database guard: rows in users", () => {
  const pool = createPool(TEST_DB);
  after(async () => {
    await pool.query("TRUNCATE user_claims, users RESTART IDENTITY");
    await pool.end();
  });
  const fakeQuery = (n: number | null) => async (sql: string) =>
    sql.includes("to_regclass") ? { rows: [{ e: n !== null }] } : { rows: [{ n }] };

  test("no users table, or few rows: passes; more than MAX_TEST_USERS (like production's 196): refused", async () => {
    await assertDisposableUsers(fakeQuery(null), "E2E_DATABASE_URL");
    await assertDisposableUsers(fakeQuery(MAX_TEST_USERS), "E2E_DATABASE_URL");
    await assert.rejects(
      assertDisposableUsers(fakeQuery(196), "E2E_DATABASE_URL"),
      /users in the database of E2E_DATABASE_URL holds 196 rows/,
    );
  });

  test("counts the real table; the synchronous form refuses a filled users table and lets an unreachable one through", async () => {
    await ensureSchema(pool);
    await pool.query("TRUNCATE user_claims, users RESTART IDENTITY");
    assert.equal(await countUsers((sql: string) => pool.query(sql)), 0);
    assert.doesNotThrow(() => assertDisposableUsersSync(TEST_DB, "TEST_DATABASE_URL"));
    await pool.query(
      `INSERT INTO users (first_name, last_name, type, subtype)
       SELECT 'ทดสอบ', 'คนที่' || i, 'RN', 'OR' FROM generate_series(1, $1::int) AS i`,
      [MAX_TEST_USERS + 1],
    );
    assert.equal(await countUsers((sql: string) => pool.query(sql)), MAX_TEST_USERS + 1);
    assert.throws(
      () => assertDisposableUsersSync(TEST_DB, "TEST_DATABASE_URL"),
      new RegExp(`holds ${MAX_TEST_USERS + 1} rows`),
    );
    // nothing listens on port 1: the guard does not decide, the tests that need the database fail on their own
    assert.doesNotThrow(() => assertDisposableUsersSync("postgres://postgres:postgres@localhost:1/x", "TEST_DATABASE_URL"));
  });
});
