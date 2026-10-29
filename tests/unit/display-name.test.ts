import "./_setup";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createRequest, decideRequest } from "@/lib/access";
import { displayNameFor, FALLBACK_NAME, profileFor } from "@/lib/auth/display-name";
import { db } from "@/lib/db";
import { setTestEnv } from "./_setup";

describe("name shown on the board (displayNameFor)", () => {
  before(async () => {
    const pool = await db();
    await pool.query("TRUNCATE user_claims, users, access_requests RESTART IDENTITY");
    await pool.query(
      `INSERT INTO users (first_name, last_name, type, subtype, active) VALUES
         ('สมชาย', 'ใจดี', 'DR', 'ORTHO', true),
         ('สมศักดิ์', 'เกษียณ', 'DR', 'EYE', false),
         ('ปราณี', 'สายบุญ', 'RN', 'OR', true),
         ('บุญมี', 'ใจซื่อ', 'PCA', 'ZZZ', true),
         ('ว่าง', 'อยู่', 'DR', 'GENSX', true),
         ('ยกเลิก', 'แล้ว', 'DR', 'URO', true)`,
    );
    // current claims (as /api/auth/claim makes them), and one an administrator undid
    await pool.query(
      `INSERT INTO user_claims (user_id, phone, line_sub, undone_at, undo_reason) VALUES
         (1, '0920000001', 'U-1', NULL, NULL), (2, '0920000002', 'U-2', NULL, NULL), (3, '0920000006', 'U-6', NULL, NULL),
         (4, '0920000007', 'U-7', NULL, NULL), (6, '0920000008', 'U-8', now(), 'admin')`,
    );
    const r = await createRequest(pool, {
      phone: "0920000003",
      sub: "U1",
      lineName: "Som",
      firstName: "สมหญิง",
      lastName: "รักดี",
      position: "RN",
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
      position: "DR",
      ip: "203.0.113.5",
    });
    assert.ok(p.status === "created");
  });
  after(async () => {
    setTestEnv();
    const pool = await db();
    await pool.query("TRUNCATE user_claims, users, access_requests RESTART IDENTITY");
    await pool.end();
  });

  test("the claimed user first (first and last name, type and subtype from users), however the number is written", async () => {
    assert.equal(await displayNameFor("0920000001", "LINE Name"), "สมชาย ใจดี");
    assert.equal(await displayNameFor(" +66 92 000 0001 ", "LINE Name"), "สมชาย ใจดี");
    assert.deepEqual(await profileFor("0920000001", "LINE Name"), { name: "สมชาย ใจดี", role: "แพทย์ · ออร์โธปิดิกส์" });
    assert.deepEqual(await profileFor("0920000006", "x"), { name: "ปราณี สายบุญ", role: "พยาบาล · ห้องผ่าตัด" });
    assert.deepEqual(await profileFor("0920000007", "x"), { name: "บุญมี ใจซื่อ", role: "พนักงานช่วยเหลือคนไข้ · ZZZ" });
    // a deactivated user names nobody (and authorizes nobody), nor does an undone claim
    assert.deepEqual(await profileFor("0920000002", "LINE Name"), { name: "LINE Name", role: null });
    assert.deepEqual(await profileFor("0920000008", "LINE Name"), { name: "LINE Name", role: null });
  });

  test("then the approved access request; a pending one does not count", async () => {
    assert.equal(await displayNameFor("0920000003", "Som"), "สมหญิง รักดี");
    assert.deepEqual(await profileFor("0920000003", "Som"), { name: "สมหญิง รักดี", role: "พยาบาล" });
    assert.equal(await displayNameFor("0920000004", "Pen"), "Pen");
  });

  test("then the LINE display name, then a generic label", async () => {
    assert.equal(await displayNameFor("0920000005", " หมอ LINE "), "หมอ LINE");
    assert.equal(await displayNameFor("0920000005", ""), FALLBACK_NAME);
    assert.equal(await displayNameFor("not a number", "หมอ LINE"), "หมอ LINE");
  });

  test("a corrected name in users shows at once (read on every call)", async () => {
    const pool = await db();
    await pool.query("UPDATE users SET last_name = 'ใจงาม' WHERE id = 1");
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
