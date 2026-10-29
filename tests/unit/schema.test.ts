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

  test("physicians: one row per canonical number, a name is required, active by default", async () => {
    const insert = (phone: string, name = "สมชาย ใจดี", dept: string | null = null) =>
      pool.query("INSERT INTO physicians (phone, name, dept) VALUES ($1, $2, $3)", [phone, name, dept]);
    await pool.query("TRUNCATE physicians");
    await insert("0812345678", "สมชาย ใจดี", "ศัลยกรรมทั่วไป");
    await insert("0912345678"); // a second number: another row, same name
    await assert.rejects(insert("0812345678"), (e: { code?: string }) => e.code === "23505");
    for (const bad of ["081-234-5679", " 0812345679", "0812345679 ", "66812345679", "0212345678", "081234567", ""]) {
      await assert.rejects(insert(bad), (e: { code?: string }) => e.code === "23514", JSON.stringify(bad));
    }
    await assert.rejects(insert("0812345670", "  "), (e: { code?: string }) => e.code === "23514");
    await assert.rejects(insert("0812345670", null as unknown as string), (e: { code?: string }) => e.code === "23502");
    const { rows } = await pool.query("SELECT active, updated_at FROM physicians WHERE phone = '0812345678'");
    assert.equal(rows[0].active, true);
    assert.ok(rows[0].updated_at instanceof Date);
    await pool.query("TRUNCATE physicians");
  });

  test("access_requests: one pending request per number, valid positions and statuses only", async () => {
    const insert = (phone: string, status = "pending", position = "nurse") =>
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
    await assert.rejects(insert("0900000003", "pending", "admin"), (e: { code?: string }) => e.code === "23514");
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
