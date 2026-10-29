import "./_setup";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createRequest, decideRequest } from "@/lib/access";
import { displayNameFor, FALLBACK_NAME } from "@/lib/auth/display-name";
import { db } from "@/lib/db";
import { setTestEnv } from "./_setup";

describe("name shown on the board (displayNameFor)", () => {
  before(async () => {
    const pool = await db();
    await pool.query("TRUNCATE physicians, access_requests RESTART IDENTITY");
    await pool.query(
      `INSERT INTO physicians (phone, name, dept, active) VALUES
         ('0920000001', ' สมชาย ใจดี ', 'ศัลยกรรมทั่วไป', true),
         ('0920000002', 'สมศักดิ์ เกษียณ', NULL, false)`,
    );
    const r = await createRequest(pool, {
      phone: "0920000003",
      sub: "U1",
      lineName: "Som",
      firstName: "สมหญิง",
      lastName: "รักดี",
      position: "nurse",
      ip: "203.0.113.5",
    });
    assert.ok(r.status === "created");
    await decideRequest(pool, r.request.id, "approved", "111");
    const p = await createRequest(pool, {
      phone: "0920000004",
      sub: "U2",
      lineName: "Pen",
      firstName: "รอ",
      lastName: "อนุมัติ",
      position: "doctor",
      ip: "203.0.113.5",
    });
    assert.ok(p.status === "created");
  });
  after(async () => {
    setTestEnv();
    const pool = await db();
    await pool.query("TRUNCATE physicians, access_requests RESTART IDENTITY");
    await pool.end();
  });

  test("the physicians row first (active or not), trimmed, however the number is written", async () => {
    assert.equal(await displayNameFor("0920000001", "LINE Name"), "สมชาย ใจดี");
    assert.equal(await displayNameFor(" +66 92 000 0001 ", "LINE Name"), "สมชาย ใจดี");
    assert.equal(await displayNameFor("0920000002", "LINE Name"), "สมศักดิ์ เกษียณ");
  });

  test("then the approved access request; a pending one does not count", async () => {
    assert.equal(await displayNameFor("0920000003", "Som"), "สมหญิง รักดี");
    assert.equal(await displayNameFor("0920000004", "Pen"), "Pen");
  });

  test("then the LINE display name, then a generic label", async () => {
    assert.equal(await displayNameFor("0920000005", " หมอ LINE "), "หมอ LINE");
    assert.equal(await displayNameFor("0920000005", ""), FALLBACK_NAME);
    assert.equal(await displayNameFor("not a number", "หมอ LINE"), "หมอ LINE");
  });

  test("a corrected row shows at once (read on every call)", async () => {
    const pool = await db();
    await pool.query("UPDATE physicians SET name = 'สมชาย ใจงาม' WHERE phone = '0920000001'");
    assert.equal(await displayNameFor("0920000001", "LINE Name"), "สมชาย ใจงาม");
  });

  test("database down: falls back to the LINE name, logs, never throws", async () => {
    process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:9/nothing_listens_here";
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
    try {
      assert.equal(await displayNameFor("0920000001", "LINE Name"), "LINE Name");
      assert.equal(await displayNameFor("0920000001", ""), FALLBACK_NAME);
    } finally {
      console.error = orig;
      setTestEnv();
    }
    assert.ok(logged.length >= 1 && logged.every((l) => !l.includes("postgres:postgres")), logged.join(" | "));
  });
});
