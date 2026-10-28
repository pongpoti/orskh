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
      `INSERT INTO physicians (email, name, dept, active) VALUES
         ('listed@example.com', ' สมชาย ใจดี ', 'ศัลยกรรมทั่วไป', true),
         ('retired@example.com', 'สมศักดิ์ เกษียณ', NULL, false)`,
    );
    const r = await createRequest(pool, {
      email: "approved@example.com",
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
      email: "pending@example.com",
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

  test("the physicians row first (active or not), trimmed, whatever the case of the address", async () => {
    assert.equal(await displayNameFor("listed@example.com", "LINE Name"), "สมชาย ใจดี");
    assert.equal(await displayNameFor(" Listed@Example.COM ", "LINE Name"), "สมชาย ใจดี");
    assert.equal(await displayNameFor("retired@example.com", "LINE Name"), "สมศักดิ์ เกษียณ");
  });

  test("then the approved access request; a pending one does not count", async () => {
    assert.equal(await displayNameFor("approved@example.com", "Som"), "สมหญิง รักดี");
    assert.equal(await displayNameFor("pending@example.com", "Pen"), "Pen");
  });

  test("then the LINE display name, then a generic label", async () => {
    assert.equal(await displayNameFor("nobody@example.com", " หมอ LINE "), "หมอ LINE");
    assert.equal(await displayNameFor("nobody@example.com", ""), FALLBACK_NAME);
    assert.equal(await displayNameFor("not an email", "หมอ LINE"), "หมอ LINE");
  });

  test("a corrected row shows at once (read on every call)", async () => {
    const pool = await db();
    await pool.query("UPDATE physicians SET name = 'สมชาย ใจงาม' WHERE email = 'listed@example.com'");
    assert.equal(await displayNameFor("listed@example.com", "LINE Name"), "สมชาย ใจงาม");
  });

  test("database down: falls back to the LINE name, logs, never throws", async () => {
    process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:9/nothing_listens_here";
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
    try {
      assert.equal(await displayNameFor("listed@example.com", "LINE Name"), "LINE Name");
      assert.equal(await displayNameFor("listed@example.com", ""), FALLBACK_NAME);
    } finally {
      console.error = orig;
      setTestEnv();
    }
    assert.ok(logged.length >= 1 && logged.every((l) => !l.includes("postgres:postgres")), logged.join(" | "));
  });
});
