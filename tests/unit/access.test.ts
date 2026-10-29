import "./_setup";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  approvedPhones,
  approvedRequest,
  cleanPersonName,
  createRequest,
  decideRequest,
  getRequest,
  latestRequest,
  parsePosition,
  REQUEST_LIMITS,
  saveTelegramRefs,
  viewFor,
  type AccessRequest,
} from "@/lib/access";
import { createPool, ensureSchema } from "@/lib/db";
import { TEST_DB } from "./_setup";

describe("access request validation", () => {
  test("names: Thai with vowels and tone marks, Latin with . - ' ; trimmed, NFC, single spaces", () => {
    assert.equal(cleanPersonName("  สมชาย  "), "สมชาย");
    assert.equal(cleanPersonName("ณัฐพงศ์"), "ณัฐพงศ์");
    assert.equal(cleanPersonName("น้ำทิพย์"), "น้ำทิพย์");
    assert.equal(cleanPersonName("ศรีสุข ณ อยุธยา"), "ศรีสุข ณ อยุธยา");
    assert.equal(cleanPersonName("Mary-Jane O'Neil"), "Mary-Jane O'Neil");
    assert.equal(cleanPersonName("J.   R."), "J. R.");
    assert.equal(cleanPersonName("Zoë"), "Zoë", "decomposed input is composed (NFC)");
    assert.equal(cleanPersonName("ก".repeat(60)), "ก".repeat(60));
  });

  test("names: refuses empty, too long, digits, symbols, emoji, control, zero-width and bidi characters", () => {
    for (const bad of [
      "",
      "   ",
      "ก".repeat(61),
      "x".repeat(300),
      "สมชาย1",
      "สมชาย๑",
      "<b>x</b>",
      "a@b",
      "a_b",
      "สมชาย 😀",
      "a\nb",
      "a\tb",
      "a\u0000b",
      "a​b",
      "a‮b",
      "a⁦b",
      "a﻿b",
      "ัabc",
      "...",
      "- '",
      null,
      42,
      ["สมชาย"],
    ]) {
      assert.equal(cleanPersonName(bad), null, `should refuse ${JSON.stringify(bad)}`);
    }
  });

  test("positions: doctor or nurse only", () => {
    assert.equal(parsePosition("doctor"), "doctor");
    assert.equal(parsePosition("nurse"), "nurse");
    for (const bad of ["", "Doctor", "แพทย์", "admin", null, 1, ["nurse"]]) assert.equal(parsePosition(bad), null);
  });
});

describe("what /login/request shows", () => {
  const base: AccessRequest = {
    id: "1",
    phone: "0900000001",
    lineSub: "U1",
    lineName: "x",
    firstName: "ก",
    lastName: "ข",
    position: "nurse",
    status: "pending",
    createdAt: new Date("2026-10-25T00:00:00Z"),
    decidedAt: null,
    decidedBy: null,
    tgMessages: [],
  };
  const now = new Date("2026-10-25T12:00:00Z").getTime();

  test("by the latest request of the number", () => {
    assert.equal(viewFor(null, "U1", now), "form");
    assert.equal(viewFor(base, "U1", now), "pending");
    assert.equal(viewFor(base, "U2", now), "pending", "pending for the number, whichever LINE account asked");
    const approved = { ...base, status: "approved" as const, decidedAt: new Date(now - 60_000) };
    assert.equal(viewFor(approved, "U1", now), "approved");
    assert.equal(viewFor(approved, "U2", now), "signin", "another LINE account signs in with LINE + code");
  });

  test("a rejection blocks a new request for 24 hours", () => {
    const rejected = { ...base, status: "rejected" as const, decidedAt: new Date(now - 23 * 3600_000) };
    assert.equal(viewFor(rejected, "U1", now), "rejected");
    assert.equal(viewFor({ ...rejected, decidedAt: new Date(now - 24 * 3600_000 - 1) }, "U1", now), "form");
    // revoked by SQL without decided_at: the request time counts
    assert.equal(viewFor({ ...rejected, decidedAt: null, createdAt: new Date(now - 3600_000) }, "U1", now), "rejected");
  });
});

describe("access requests (database)", () => {
  const pool = createPool(TEST_DB);
  const person = { lineName: "LINE คน", firstName: "สมหญิง", lastName: "ใจดี", position: "nurse" as const, ip: "203.0.113.9" };

  before(async () => {
    await pool.query("DROP TABLE IF EXISTS otp_codes, line_bindings, login_events, physicians, access_requests");
    await ensureSchema(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE access_requests RESTART IDENTITY");
  });
  after(() => pool.end());

  const create = (phone: string, sub: string) => createRequest(pool, { phone, sub, ...person });

  test("creates a pending request; a second one for the same phone is not stored", async () => {
    const r = await create("0900000011", "U1");
    assert.equal(r.status, "created");
    assert.ok(r.status === "created");
    assert.equal(r.request.status, "pending");
    assert.equal(r.request.firstName, "สมหญิง");
    assert.equal(r.request.position, "nurse");
    assert.equal(r.request.lineName, "LINE คน");
    assert.deepEqual(await create("0900000011", "U1"), { status: "exists", view: "pending" });
    assert.deepEqual(await create("0900000011", "U2"), { status: "exists", view: "pending" });
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM access_requests");
    assert.equal(rows[0].n, 1);
  });

  test("concurrent requests for one phone store exactly one", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => create("0900000012", `Ur${i}`)));
    assert.equal(results.filter((r) => r.status === "created").length, 1);
    assert.ok(results.every((r) => r.status === "created" || (r.status === "exists" && r.view === "pending")));
  });

  test(`at most ${REQUEST_LIMITS.perSubDay} requests per LINE account per 24 h`, async () => {
    for (let i = 0; i < REQUEST_LIMITS.perSubDay; i++) assert.equal((await create(`090000010${i}`, "Umany")).status, "created");
    const r = await create("0900000109", "Umany");
    assert.ok(r.status === "limited" && r.retryAfterS > 0 && r.retryAfterS <= 24 * 3600, JSON.stringify(r));
    assert.equal((await create("0900000109", "Uother")).status, "created", "other accounts are not affected");
    await pool.query("UPDATE access_requests SET created_at = created_at - interval '24 hours 1 second'");
    assert.equal((await create("0900000110", "Umany")).status, "created");
  });

  test("decisions are atomic: one of many concurrent taps decides, the rest see it decided", async () => {
    const r = await create("0900000013", "U1");
    assert.ok(r.status === "created");
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => decideRequest(pool, r.request.id, i % 2 ? "rejected" : "approved", "111")),
    );
    const decided = results.filter((x) => x.outcome === "decided");
    assert.equal(decided.length, 1);
    assert.equal(results.filter((x) => x.outcome === "already").length, 5);
    const row = await getRequest(pool, r.request.id);
    assert.ok(row && decided[0].outcome === "decided" && row.status === decided[0].request.status);
    assert.equal(row?.decidedBy, "111");
    assert.ok(row?.decidedAt instanceof Date);
    assert.deepEqual(await decideRequest(pool, "999999", "approved", "111"), { outcome: "missing" });
  });

  test("approval: approved numbers, the approved request per LINE account, and no new request", async () => {
    const r = await create("0900000014", "U1");
    assert.ok(r.status === "created");
    assert.deepEqual([...(await approvedPhones(pool))], []);
    await decideRequest(pool, r.request.id, "approved", "111");
    assert.deepEqual([...(await approvedPhones(pool))], ["0900000014"]);
    assert.equal((await approvedRequest(pool, "0900000014"))?.id, r.request.id);
    assert.equal((await approvedRequest(pool, "0900000014", "U1"))?.id, r.request.id);
    assert.equal(await approvedRequest(pool, "0900000014", "U2"), null);
    assert.deepEqual(await create("0900000014", "U1"), { status: "exists", view: "approved" });
    assert.deepEqual(await create("0900000014", "U2"), { status: "exists", view: "signin" });
  });

  test("rejection: no new request for 24 h, then allowed again", async () => {
    const r = await create("0900000015", "U1");
    assert.ok(r.status === "created");
    await decideRequest(pool, r.request.id, "rejected", "111");
    assert.deepEqual(await create("0900000015", "U1"), { status: "exists", view: "rejected" });
    await pool.query("UPDATE access_requests SET decided_at = now() - interval '25 hours', created_at = now() - interval '25 hours'");
    assert.equal((await create("0900000015", "U1")).status, "created");
    assert.equal((await latestRequest(pool, "0900000015"))?.status, "pending");
  });

  test("Telegram message references are appended to the row", async () => {
    const r = await create("0900000016", "U1");
    assert.ok(r.status === "created");
    await saveTelegramRefs(pool, r.request.id, [{ chat_id: "111", message_id: 7 }]);
    await saveTelegramRefs(pool, r.request.id, [{ chat_id: "222", message_id: 9 }]);
    assert.deepEqual((await getRequest(pool, r.request.id))?.tgMessages, [
      { chat_id: "111", message_id: 7 },
      { chat_id: "222", message_id: 9 },
    ]);
  });
});
