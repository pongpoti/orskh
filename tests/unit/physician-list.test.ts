import "./_setup";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import { activePhysicianPhones, isActivePhysician, physicianFor } from "@/lib/physician-list";
import { TEST_DB } from "./_setup";

const DOWN = "postgres://postgres:postgres@127.0.0.1:9/nothing_listens_here";

describe("physician list (table physicians)", () => {
  const pool = createPool(TEST_DB);

  before(async () => {
    await ensureSchema(pool);
    await pool.query("TRUNCATE physicians");
    await pool.query(
      `INSERT INTO physicians (phone, name, dept, active) VALUES
         ('0900000002', ' สมชาย ใจดี ', 'ศัลยกรรมทั่วไป', true),
         ('0800000002', ' สมชาย ใจดี ', 'ศัลยกรรมทั่วไป', true),
         ('0611111111', 'สมหญิง รักดี', '  ', true),
         ('0920000002', 'สมศักดิ์ เกษียณ', NULL, false)`,
    );
  });
  after(async () => {
    await pool.query("TRUNCATE physicians");
    await pool.end();
  });

  test("name and department for the alert, for active and inactive rows; trimmed, blank dept is null", async () => {
    assert.deepEqual(await physicianFor(pool, "0900000002"), { name: "สมชาย ใจดี", dept: "ศัลยกรรมทั่วไป" });
    assert.deepEqual(await physicianFor(pool, "0800000002"), { name: "สมชาย ใจดี", dept: "ศัลยกรรมทั่วไป" });
    assert.deepEqual(await physicianFor(pool, "0611111111"), { name: "สมหญิง รักดี", dept: null });
    assert.deepEqual(await physicianFor(pool, "0920000002"), { name: "สมศักดิ์ เกษียณ", dept: null });
    assert.equal(await physicianFor(pool, "0920000005"), null);
    assert.equal(await physicianFor(pool, "__proto__"), null);
  });

  test("only active rows are on the list", async () => {
    assert.deepEqual(
      [...(await activePhysicianPhones(pool))].sort(),
      ["0611111111", "0800000002", "0900000002"],
    );
    assert.equal(await isActivePhysician(pool, "0900000002"), true);
    assert.equal(await isActivePhysician(pool, "0920000002"), false);
    assert.equal(await isActivePhysician(pool, "0920000005"), false);
  });

  test("database down: the name lookup returns null and logs, never throws", async () => {
    const down = createPool(DOWN);
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
    try {
      assert.equal(await physicianFor(down, "0900000002"), null);
    } finally {
      console.error = orig;
      await down.end();
    }
    assert.equal(logged.length, 1);
    assert.match(logged[0], /\[physicians\] lookup failed/);
    assert.ok(!logged[0].includes("postgres:postgres"), "no credentials logged");
  });

  test("no roster CSV is committed (the list lives in the table; the CSV stays outside the repository)", () => {
    const tracked = execFileSync("git", ["ls-files", "*.csv"], { encoding: "utf8" }).trim();
    assert.equal(tracked, "");
  });
});
