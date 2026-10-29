import "./_setup";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import { SCHEMA_SQL } from "@/lib/schema";
import { normalizeDdl, PRODUCTION_USERS_DDL } from "./production-users-ddl";
import { TEST_DB } from "./_setup";

describe("database schema", () => {
  const pool = createPool(TEST_DB);
  after(() => pool.end());

  test("lib/schema.ts is identical to db/schema.sql", () => {
    assert.equal(SCHEMA_SQL, readFileSync("db/schema.sql", "utf8"));
  });

  test("applies to an empty database and is idempotent (also under concurrency)", async () => {
    await pool.query("DROP TABLE IF EXISTS otp_codes, line_bindings, login_events, user_claims, users, access_requests");
    await Promise.all([ensureSchema(pool), ensureSchema(pool), ensureSchema(pool)]);
    await ensureSchema(pool);
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
    );
    const names = rows.map((r) => r.table_name);
    for (const t of ["access_requests", "line_bindings", "login_events", "otp_codes", "user_claims", "users"]) {
      assert.ok(names.includes(t), t);
    }
    for (const old of ["physicians", "staff", "staff_claims"]) assert.ok(!names.includes(old), `no ${old} table`);
  });

  test("the users statement in db/schema.sql is the production DDL (README quotes the same text)", () => {
    const sql = readFileSync("db/schema.sql", "utf8");
    const m = /CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/.exec(sql);
    assert.ok(m, "a CREATE TABLE IF NOT EXISTS users statement");
    assert.equal(normalizeDdl(m[0].replace("CREATE TABLE IF NOT EXISTS users", "CREATE TABLE users")), normalizeDdl(PRODUCTION_USERS_DDL));
    assert.ok(normalizeDdl(readFileSync("README.md", "utf8")).includes(normalizeDdl(PRODUCTION_USERS_DDL)), "README shows the DDL");
    // nothing in db/schema.sql alters users (no column, constraint, index or trigger of the sign-in's own)
    assert.doesNotMatch(sql, /ALTER TABLE (IF EXISTS )?users\b/i);
    assert.doesNotMatch(sql, /\bON users\b/i);
    assert.doesNotMatch(sql, /\b(INSERT INTO|UPDATE|DELETE FROM) users\b/i);
  });

  /** Columns, constraints and indexes of a table, as the catalog has them (names included). */
  async function shape(schema: string, table: string) {
    const cols = await pool.query(
      `SELECT column_name, ordinal_position, data_type, is_nullable, column_default, is_identity, identity_generation
       FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
      [schema, table],
    );
    const cons = await pool.query(
      `SELECT conname, contype, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
       WHERE conrelid = format('%I.%I', $1::text, $2::text)::regclass ORDER BY contype, pg_get_constraintdef(c.oid)`,
      [schema, table],
    );
    const idx = await pool.query(
      `SELECT indexname, regexp_replace(indexdef, ' ON [a-z_]+\\.', ' ON ') AS def FROM pg_indexes
       WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
      [schema, table],
    );
    const trg = await pool.query(
      "SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = format('%I.%I', $1::text, $2::text)::regclass AND NOT tgisinternal",
      [schema, table],
    );
    return {
      columns: cols.rows,
      constraints: cons.rows.map((r) => ({ ...r, conname: r.conname.replace(/^\d+_\d+_\d+_not_null$/, "not_null") })),
      indexes: idx.rows,
      triggers: trg.rows[0].n,
    };
  }

  test("users made by db/schema.sql is identical, in the catalog, to users made by the production DDL", async () => {
    await pool.query("DROP SCHEMA IF EXISTS prod_mirror CASCADE");
    await pool.query("CREATE SCHEMA prod_mirror");
    try {
      const c = await pool.connect();
      try {
        await c.query("SET search_path TO prod_mirror");
        await c.query(PRODUCTION_USERS_DDL);
      } finally {
        await c.query("RESET search_path");
        c.release();
      }
      await ensureSchema(pool);
      const prod = await shape("prod_mirror", "users");
      const ours = await shape("public", "users");
      assert.deepEqual(ours, prod);
      assert.deepEqual(
        prod.columns.map((col) => col.column_name),
        ["id", "first_name", "last_name", "type", "subtype", "active", "created_at", "updated_at"],
      );
      assert.ok(prod.constraints.some((k) => k.conname === "users_name_key" && k.def === "UNIQUE (first_name, last_name)"));
    } finally {
      await pool.query("DROP SCHEMA IF EXISTS prod_mirror CASCADE");
    }
  });

  test("on a database where users already exists with data (production), applying the schema twice leaves users untouched", async () => {
    await pool.query("DROP TABLE IF EXISTS otp_codes, line_bindings, login_events, user_claims, users, access_requests");
    await pool.query(PRODUCTION_USERS_DDL);
    await pool.query(
      `INSERT INTO users (first_name, last_name, type, subtype) VALUES
         ('สมชาย', 'ใจดี', 'DR', 'ORTHO'), ('ปราณี', 'สายบุญ', 'RN', 'OR'), ('บุญมี', 'ใจซื่อ', 'PCA', 'Some unit')`,
    );
    await pool.query("UPDATE users SET active = false, updated_at = now() - interval '3 days' WHERE first_name = 'บุญมี'");
    // xmin changes whenever a row is written: equal xmin means no row was touched
    const snapshot = async () => (await pool.query("SELECT xmin::text AS xmin, * FROM users ORDER BY id")).rows;
    const rowsBefore = await snapshot();
    const shapeBefore = await shape("public", "users");
    const sequence = async () => (await pool.query("SELECT last_value::text AS v FROM users_id_seq")).rows[0].v;
    const seqBefore = await sequence();
    await ensureSchema(pool);
    await ensureSchema(pool);
    assert.deepEqual(await snapshot(), rowsBefore, "no row written");
    assert.deepEqual(await shape("public", "users"), shapeBefore, "no column, constraint, index or trigger added");
    assert.equal(await sequence(), seqBefore, "identity untouched");
    // the sign-in tables were created next to it, and user_claims references it
    const fk = await pool.query(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'user_claims'::regclass AND contype = 'f'",
    );
    assert.deepEqual(fk.rows.map((r) => r.def), ["FOREIGN KEY (user_id) REFERENCES users(id)"]);
    await pool.query("TRUNCATE user_claims, users RESTART IDENTITY");
  });

  test("users: one row per (first name, last name); valid types; names and subtype not blank; ids from the identity only", async () => {
    const insert = (first: string, last: string, type = "DR", subtype: string | null = "ORTHO") =>
      pool.query<{ id: number }>("INSERT INTO users (first_name, last_name, type, subtype) VALUES ($1, $2, $3, $4) RETURNING id", [
        first,
        last,
        type,
        subtype,
      ]);
    const code = (c: string) => (e: { code?: string }) => e.code === c;
    await pool.query("TRUNCATE user_claims, users RESTART IDENTITY");
    const a = (await insert("สมชาย", "ใจดี", "DR", "ORTHO")).rows[0].id;
    assert.equal(a, 1);
    await assert.rejects(insert("สมชาย", "ใจดี", "RN", "OR"), (e: { code?: string; constraint?: string }) => e.code === "23505" && e.constraint === "users_name_key");
    for (const type of ["dr", "MD", "", "NURSE"]) await assert.rejects(insert("ก", "ข", type), code("23514"), type);
    for (const sub of ["", "  "]) await assert.rejects(insert("ก", "ข", "RN", sub), code("23514"), JSON.stringify(sub));
    await assert.rejects(insert("ก", "ข", "RN", null), code("23502"));
    await assert.rejects(insert("  ", "ข"), code("23514"));
    await assert.rejects(insert("ก", ""), code("23514"));
    await assert.rejects(pool.query("INSERT INTO users (id, first_name, last_name, type, subtype) VALUES (99, 'ก', 'ข', 'DR', 'EYE')"), code("428C9"));
    const { rows } = await pool.query("SELECT active, created_at, updated_at FROM users WHERE id = $1", [a]);
    assert.equal(rows[0].active, true);
    assert.ok(rows[0].created_at instanceof Date && rows[0].updated_at instanceof Date);
    await pool.query("TRUNCATE user_claims, users RESTART IDENTITY");
  });

  test("user_claims: a real user, a valid number, one current claim per user, number and LINE account, an ended claim names its reason", async () => {
    await pool.query("TRUNCATE user_claims, users RESTART IDENTITY");
    await pool.query("INSERT INTO users (first_name, last_name, type, subtype) VALUES ('ก', 'ข', 'DR', 'EYE'), ('ค', 'ง', 'RN', 'OR')");
    const claim = (user: number, phone: string, sub: string) =>
      pool.query("INSERT INTO user_claims (user_id, phone, line_sub) VALUES ($1, $2, $3) RETURNING *", [user, phone, sub]);
    const code = (c: string, constraint?: string) => (e: { code?: string; constraint?: string }) =>
      e.code === c && (constraint === undefined || e.constraint === constraint);
    await assert.rejects(claim(999, "0812345678", "U1"), code("23503"));
    for (const bad of ["081-234-5679", " 0812345679", "66812345679", "0212345678", "081234567", ""]) {
      await assert.rejects(claim(1, bad, "U1"), code("23514"), JSON.stringify(bad));
    }
    const first = await claim(1, "0812345678", "U1");
    assert.deepEqual(
      [first.rows[0].tg_messages, first.rows[0].undone_at, first.rows[0].undone_by, first.rows[0].undo_reason],
      [[], null, null, null],
    );
    await assert.rejects(claim(1, "0812345679", "U2"), code("23505", "user_claims_current_user_key"));
    await assert.rejects(claim(2, "0812345678", "U2"), code("23505", "user_claims_current_phone_key"));
    await assert.rejects(claim(2, "0812345679", "U1"), code("23505", "user_claims_current_line_sub_key"));
    await assert.rejects(pool.query("UPDATE user_claims SET undone_at = now() WHERE id = $1", [first.rows[0].id]), code("23514"));
    await assert.rejects(pool.query("UPDATE user_claims SET undo_reason = 'admin' WHERE id = $1", [first.rows[0].id]), code("23514"));
    await assert.rejects(pool.query("UPDATE user_claims SET undone_at = now(), undo_reason = 'later' WHERE id = $1", [first.rows[0].id]), code("23514"));
    for (const reason of ["admin", "inactive", "manual"]) {
      await pool.query("UPDATE user_claims SET undone_at = now(), undo_reason = $1 WHERE undone_at IS NULL", [reason]);
      await claim(1, "0812345678", "U1"); // free again once ended
    }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_claims")).rows[0].n, 4);
    await pool.query("TRUNCATE user_claims, users RESTART IDENTITY");
  });

  test("an old access_requests table (positions doctor and nurse) moves to the user types", async () => {
    await pool.query("DROP TABLE access_requests");
    await pool.query(
      `CREATE TABLE access_requests (id bigserial PRIMARY KEY, phone text NOT NULL, line_sub text NOT NULL, line_name text,
         first_name text NOT NULL, last_name text NOT NULL,
         position text NOT NULL CHECK (position IN ('doctor', 'nurse')),
         status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
         created_at timestamptz NOT NULL DEFAULT now(), ip text, decided_at timestamptz, decided_by bigint,
         tg_messages jsonb NOT NULL DEFAULT '[]'::jsonb)`,
    );
    await pool.query(
      `INSERT INTO access_requests (phone, line_sub, first_name, last_name, position)
       VALUES ('0900000001', 'U1', 'ก', 'ข', 'doctor'), ('0900000002', 'U2', 'ก', 'ข', 'nurse')`,
    );
    await ensureSchema(pool);
    await ensureSchema(pool);
    const { rows } = await pool.query("SELECT position FROM access_requests ORDER BY id");
    assert.deepEqual(rows.map((r) => r.position), ["DR", "RN"]);
    await assert.rejects(
      pool.query("INSERT INTO access_requests (phone, line_sub, first_name, last_name, position) VALUES ('0900000003', 'U3', 'ก', 'ข', 'doctor')"),
      (e: { code?: string }) => e.code === "23514",
    );
    await pool.query("DROP TABLE access_requests");
    await ensureSchema(pool);
  });

  test("access_requests: one pending request per number, valid positions and statuses only", async () => {
    const insert = (phone: string, status = "pending", position = "RN") =>
      pool.query(
        `INSERT INTO access_requests (phone, line_sub, first_name, last_name, position, status)
         VALUES ($1, 'U1', 'ก', 'ข', $2, $3)`,
        [phone, position, status],
      );
    await pool.query("TRUNCATE access_requests");
    await insert("0900000001");
    await assert.rejects(insert("0900000001"), (e: { code?: string }) => e.code === "23505");
    await insert("0900000001", "rejected");
    await insert("0900000001", "approved");
    await insert("0900000002");
    for (const p of ["DR", "PN", "PCA"]) await insert("0900000004", "rejected", p);
    for (const p of ["admin", "doctor", "nurse", "dr"]) {
      await assert.rejects(insert("0900000003", "pending", p), (e: { code?: string }) => e.code === "23514", p);
    }
    await assert.rejects(insert("0900000003", "maybe"), (e: { code?: string }) => e.code === "23514");
    const { rows } = await pool.query("SELECT tg_messages, decided_at FROM access_requests LIMIT 1");
    assert.deepEqual(rows[0], { tg_messages: [], decided_at: null });
    await pool.query("TRUNCATE access_requests");
  });

  test("otp_codes has no column that could hold a plaintext code (only an HMAC or the sealed provider token)", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'otp_codes' ORDER BY ordinal_position",
    );
    assert.deepEqual(
      rows.map((r) => r.column_name),
      ["id", "phone", "line_sub", "code_hash", "provider_token", "ref", "created_at", "expires_at", "attempts", "used_at", "ip"],
    );
  });
});
