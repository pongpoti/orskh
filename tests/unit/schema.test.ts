import "./_setup";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import { SCHEMA_SQL } from "@/lib/schema";
import { TEST_DB } from "./_setup";

describe("database schema", () => {
  const pool = createPool(TEST_DB);
  after(() => pool.end());

  test("lib/schema.ts is identical to db/schema.sql", () => {
    assert.equal(SCHEMA_SQL, readFileSync("db/schema.sql", "utf8"));
  });

  test("applies to an empty database and is idempotent (also under concurrency)", async () => {
    await pool.query("DROP TABLE IF EXISTS otp_codes, line_bindings, login_events, physicians, access_requests");
    await Promise.all([ensureSchema(pool), ensureSchema(pool), ensureSchema(pool)]);
    await ensureSchema(pool);
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
    );
    const names = rows.map((r) => r.table_name);
    for (const t of ["access_requests", "line_bindings", "login_events", "otp_codes", "physicians"]) {
      assert.ok(names.includes(t), t);
    }
  });

  test("physicians: one row per normalized email, a name is required, active by default", async () => {
    const insert = (email: string, name = "สมชาย ใจดี", dept: string | null = null) =>
      pool.query("INSERT INTO physicians (email, name, dept) VALUES ($1, $2, $3)", [email, name, dept]);
    await pool.query("TRUNCATE physicians");
    await insert("doc@example.com", "สมชาย ใจดี", "ศัลยกรรมทั่วไป");
    await insert("doc.alt@example.com"); // an alternate address: another row, same name
    await assert.rejects(insert("doc@example.com"), (e: { code?: string }) => e.code === "23505");
    for (const bad of ["Doc@Example.com", " doc2@example.com", "doc2@example.com ", ""]) {
      await assert.rejects(insert(bad), (e: { code?: string }) => e.code === "23514", JSON.stringify(bad));
    }
    await assert.rejects(insert("doc3@example.com", "  "), (e: { code?: string }) => e.code === "23514");
    await assert.rejects(insert("doc3@example.com", null as unknown as string), (e: { code?: string }) => e.code === "23502");
    const { rows } = await pool.query("SELECT active, updated_at FROM physicians WHERE email = 'doc@example.com'");
    assert.equal(rows[0].active, true);
    assert.ok(rows[0].updated_at instanceof Date);
    await pool.query("TRUNCATE physicians");
  });

  test("access_requests: one pending request per email, valid positions and statuses only", async () => {
    const insert = (email: string, status = "pending", position = "nurse") =>
      pool.query(
        `INSERT INTO access_requests (email, line_sub, first_name, last_name, position, status)
         VALUES ($1, 'U1', 'ก', 'ข', $2, $3)`,
        [email, position, status],
      );
    await pool.query("TRUNCATE access_requests");
    await insert("a@example.com");
    await assert.rejects(insert("a@example.com"), (e: { code?: string }) => e.code === "23505");
    await insert("a@example.com", "rejected");
    await insert("a@example.com", "approved");
    await insert("b@example.com");
    await assert.rejects(insert("c@example.com", "pending", "admin"), (e: { code?: string }) => e.code === "23514");
    await assert.rejects(insert("c@example.com", "maybe"), (e: { code?: string }) => e.code === "23514");
    const { rows } = await pool.query("SELECT tg_messages, decided_at FROM access_requests LIMIT 1");
    assert.deepEqual(rows[0], { tg_messages: [], decided_at: null });
    await pool.query("TRUNCATE access_requests");
  });

  test("otp_codes has no column that could hold a plaintext code", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'otp_codes' ORDER BY ordinal_position",
    );
    assert.deepEqual(
      rows.map((r) => r.column_name),
      ["id", "email", "line_sub", "code_hash", "created_at", "expires_at", "attempts", "used_at", "ip"],
    );
  });
});
