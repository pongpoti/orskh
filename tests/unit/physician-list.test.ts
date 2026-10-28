import "./_setup";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import { activePhysicianEmails, isActivePhysician, physicianFor } from "@/lib/physician-list";
import { TEST_DB } from "./_setup";

const DOWN = "postgres://postgres:postgres@127.0.0.1:9/nothing_listens_here";

describe("physician list (table physicians)", () => {
  const pool = createPool(TEST_DB);

  before(async () => {
    await ensureSchema(pool);
    await pool.query("TRUNCATE physicians");
    await pool.query(
      `INSERT INTO physicians (email, name, dept, active) VALUES
         ('doc2@example.com', ' สมชาย ใจดี ', 'ศัลยกรรมทั่วไป', true),
         ('doc2.alt@example.com', ' สมชาย ใจดี ', 'ศัลยกรรมทั่วไป', true),
         ('third@example.com', 'สมหญิง รักดี', '  ', true),
         ('retired@example.com', 'สมศักดิ์ เกษียณ', NULL, false)`,
    );
  });
  after(async () => {
    await pool.query("TRUNCATE physicians");
    await pool.end();
  });

  test("name and department for the alert, for active and inactive rows; trimmed, blank dept is null", async () => {
    assert.deepEqual(await physicianFor(pool, "doc2@example.com"), { name: "สมชาย ใจดี", dept: "ศัลยกรรมทั่วไป" });
    assert.deepEqual(await physicianFor(pool, "doc2.alt@example.com"), { name: "สมชาย ใจดี", dept: "ศัลยกรรมทั่วไป" });
    assert.deepEqual(await physicianFor(pool, "third@example.com"), { name: "สมหญิง รักดี", dept: null });
    assert.deepEqual(await physicianFor(pool, "retired@example.com"), { name: "สมศักดิ์ เกษียณ", dept: null });
    assert.equal(await physicianFor(pool, "nobody@example.com"), null);
    assert.equal(await physicianFor(pool, "__proto__"), null);
  });

  test("only active rows are on the list", async () => {
    assert.deepEqual(
      [...(await activePhysicianEmails(pool))].sort(),
      ["doc2.alt@example.com", "doc2@example.com", "third@example.com"],
    );
    assert.equal(await isActivePhysician(pool, "doc2@example.com"), true);
    assert.equal(await isActivePhysician(pool, "retired@example.com"), false);
    assert.equal(await isActivePhysician(pool, "nobody@example.com"), false);
  });

  test("database down: the name lookup returns null and logs, never throws", async () => {
    const down = createPool(DOWN);
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
    try {
      assert.equal(await physicianFor(down, "doc2@example.com"), null);
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
