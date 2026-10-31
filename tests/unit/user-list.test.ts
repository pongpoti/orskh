import "./_setup";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { POST as claimRoute } from "@/app/api/auth/claim/route";
import { GET as listRoute } from "@/app/api/auth/claim/list/route";
import { createRequest, decideRequest } from "@/lib/access";
import { isAuthorizedPhone, resetAuthzCache } from "@/lib/authz";
import { db } from "@/lib/db";
import { upsertBinding } from "@/lib/otp";
import { matchesName, roleLabel, subtypeLabel, TYPE_LABELS } from "@/lib/user-labels";
import {
  activePhones,
  CLAIM_LIMITS,
  claimBlocked,
  claimUser,
  getClaim,
  holdsActiveName,
  listClaimable,
  undoClaim,
  userForPhone,
} from "@/lib/user-list";
import { MSG } from "@/lib/http";
import { claimsEnabled } from "@/lib/telegram";
import { signAccess } from "@/lib/tokens";
import { setTestEnv, TEST_SESSION_SECRET } from "./_setup";

// Invented names and numbers only.
describe("user labels (lib/user-labels.ts)", () => {
  test("types and subtypes in Thai: doctors by the app's specialty names, nurses by unit, unknown codes as they are", () => {
    assert.deepEqual(TYPE_LABELS, { DR: "แพทย์", RN: "พยาบาล", PN: "ผู้ช่วยพยาบาล", PCA: "พนักงานช่วยเหลือคนไข้" });
    assert.equal(subtypeLabel("DR", "ORTHO"), "ออร์โธปิดิกส์");
    assert.equal(subtypeLabel("DR", "GENSX"), "ศัลยกรรมทั่วไป");
    assert.equal(subtypeLabel("DR", "VASCULAR"), "ศัลยกรรมหลอดเลือด");
    assert.equal(subtypeLabel("DR", "NEPHRO"), "อายุรกรรมโรคไต", "from the department list");
    assert.equal(subtypeLabel("DR", "ANES"), "วิสัญญี");
    assert.equal(subtypeLabel("DR", "CHEST"), "อายุรกรรมโรคปอด");
    assert.equal(subtypeLabel("DR", "ZZZ"), "ZZZ", "no label: the code");
    assert.equal(subtypeLabel("DR", "constructor"), "constructor", "no prototype lookups");
    assert.equal(subtypeLabel("RN", "OR"), "ห้องผ่าตัด");
    assert.equal(subtypeLabel("PN", "ANES"), "วิสัญญี");
    assert.equal(subtypeLabel("PCA", "OR"), "ห้องผ่าตัด");
    assert.equal(subtypeLabel("RN", "ICU"), "ICU");
    assert.equal(subtypeLabel("RN", null), null);
    assert.equal(subtypeLabel("DR", " "), null);
    assert.equal(roleLabel("DR", "ORTHO"), "แพทย์ · ออร์โธปิดิกส์");
    assert.equal(roleLabel("PCA", null), "พนักงานช่วยเหลือคนไข้");
  });

  test("every subtype code the users list uses has a Thai label", () => {
    // codes from the README and from the hospital's list (codes only; the list itself never enters the repository)
    for (const code of ["ANES", "CHEST", "CVT", "ENT", "EYE", "GENSX", "NEPHRO", "NEURO", "OBGYN", "ORTHO", "PEDSX", "PLASTIC", "URO", "VASCULAR"]) {
      const label = subtypeLabel("DR", code);
      assert.ok(label && label !== code && /[\u0E00-\u0E7F]/.test(label), `DR ${code}: ${label}`);
    }
    for (const type of ["RN", "PN", "PCA"]) {
      for (const code of ["OR", "ANES"]) assert.match(subtypeLabel(type, code) ?? "", /[\u0E00-\u0E7F]/, `${type} ${code}`);
    }
  });

  test("search: first or last name, any part, extra or missing spaces, invisible characters, case", () => {
    const m = (q: string) => matchesName(q, "สมชาย", "ใจดี");
    for (const q of ["", "  ", "สม", "ชาย", "ใจ", "ใจดี", "สมชาย ใจดี", "  สมชาย    ใจดี ", "สมชายใจดี", "ชาย ใจ", "สม​ชาย", "ใจดี สมชาย"]) {
      assert.equal(m(q), true, JSON.stringify(q));
    }
    for (const q of ["สมหญิง", "ดีใจ", "x"]) assert.equal(m(q), false, q);
    assert.equal(matchesName("o'neil", "Mary", "O'Neil"), true);
    assert.equal(matchesName("น้ำ".normalize("NFD"), "น้ำทิพย์", "ใจ"), true, "NFC on both sides");
  });
});

describe("users and claims (database)", () => {
  let pool: Pool;
  const ids: Record<string, string> = {};
  const args = (userId: string, phone: string, sub: string) => ({
    userId,
    phone,
    sub,
    lineName: `LINE ${sub}`,
    ip: "203.0.113.7",
    userAgent: "test",
  });
  /** A current claim made directly in the table (as by hand in SQL, or by an earlier claim). */
  const hold = (userId: string, phone: string, sub: string) =>
    pool.query<{ id: string }>("INSERT INTO user_claims (user_id, phone, line_sub) VALUES ($1, $2, $3) RETURNING id::text AS id", [
      userId,
      phone,
      sub,
    ]);
  const current = async (userId: string) =>
    (await pool.query("SELECT phone, line_sub FROM user_claims WHERE user_id = $1 AND undone_at IS NULL", [userId])).rows[0] ?? null;
  /** users exactly as loaded: the claims never write it. */
  const usersSnapshot = async () => (await pool.query("SELECT * FROM users ORDER BY id")).rows;

  async function load() {
    await pool.query("TRUNCATE user_claims, users, line_bindings, login_events, access_requests RESTART IDENTITY");
    const { rows } = await pool.query<{ id: string; key: string }>(
      `INSERT INTO users (first_name, last_name, type, subtype, active) VALUES
         ('สมชาย', 'ใจดี', 'DR', 'ORTHO', true),
         ('กมล', 'ทองดี', 'DR', 'OBGYN', true),
         ('ชัยวัฒน์', 'มีสุข', 'DR', 'NEURO', true),
         ('เกษียณ', 'แล้ว', 'DR', 'EYE', false),
         ('ปราณี', 'สายบุญ', 'RN', 'OR', true),
         ('วิไล', 'แสงทอง', 'RN', 'ANES', true),
         ('สมชาย', 'ใจงาม', 'RN', 'OR', true)
       RETURNING id::text AS id, type || ':' || first_name AS key`,
    );
    for (const r of rows) ids[r.key] = r.id;
  }

  before(async () => {
    setTestEnv();
    pool = await db();
  });
  beforeEach(async () => {
    resetAuthzCache();
    await load();
  });
  after(async () => {
    await pool.query("TRUNCATE user_claims, users, line_bindings, login_events, access_requests RESTART IDENTITY");
    await pool.end();
  });

  test("listClaimable: active names of one type in Thai order, whether taken (a current claim), and nothing else", async () => {
    await hold(ids["DR:กมล"], "0900000201", "U-secret");
    const undone = await hold(ids["DR:สมชาย"], "0900000203", "U-old");
    await pool.query("UPDATE user_claims SET undone_at = now(), undo_reason = 'manual' WHERE id = $1", [undone.rows[0].id]);
    const list = await listClaimable(pool, "DR");
    assert.deepEqual(
      list.map((n) => [n.first_name, n.last_name, n.subtype, n.claimed]),
      [
        ["กมล", "ทองดี", "OBGYN", true],
        ["ชัยวัฒน์", "มีสุข", "NEURO", false],
        ["สมชาย", "ใจดี", "ORTHO", false],
      ],
    );
    for (const n of list) assert.deepEqual(Object.keys(n).sort(), ["claimed", "first_name", "id", "last_name", "subtype"]);
    assert.ok(!JSON.stringify(list).includes("0900000201") && !JSON.stringify(list).includes("U-secret"));
    assert.deepEqual((await listClaimable(pool, "PN")).length, 0);
  });

  test("claim: one user_claims row (users untouched); the number is then authorized and named from users", async () => {
    const before = await usersSnapshot();
    assert.equal(await isAuthorizedPhone("0900000202"), false);
    const r = await claimUser(pool, args(ids["DR:สมชาย"], "0900000202", "U-a"));
    assert.equal(r.status, "claimed");
    assert.ok(r.status === "claimed");
    assert.deepEqual(r.user, { id: ids["DR:สมชาย"], firstName: "สมชาย", lastName: "ใจดี", type: "DR", subtype: "ORTHO" });
    assert.equal(r.claim.userId, ids["DR:สมชาย"]);
    assert.equal(r.claim.phone, "0900000202");
    assert.equal(r.claim.lineSub, "U-a");
    assert.equal(r.claim.lineName, "LINE U-a");
    assert.equal(r.claim.undoneAt, null);
    assert.equal(r.claim.undoReason, null);
    assert.deepEqual(await usersSnapshot(), before, "users is never written");
    assert.deepEqual(await current(ids["DR:สมชาย"]), { phone: "0900000202", line_sub: "U-a" });
    assert.deepEqual(await userForPhone(pool, "0900000202"), r.user);
    assert.equal(await holdsActiveName(pool, "0900000202"), true);
    assert.deepEqual([...(await activePhones(pool))], ["0900000202"]);
    resetAuthzCache();
    assert.equal(await isAuthorizedPhone("0900000202"), true);
    const ev = await pool.query("SELECT event, line_sub, ip FROM login_events WHERE phone = '0900000202'");
    assert.deepEqual(ev.rows, [{ event: "claim", line_sub: "U-a", ip: "203.0.113.7" }]);
    // the LINE account is bound to the number in the same transaction
    const b = await pool.query("SELECT line_sub, display_name FROM line_bindings WHERE phone = '0900000202'");
    assert.deepEqual(b.rows, [{ line_sub: "U-a", display_name: "LINE U-a" }]);
    // a current claim on an inactive user authorizes nothing (and names nothing)
    await pool.query("UPDATE users SET active = false WHERE id = $1", [ids["DR:สมชาย"]]);
    assert.equal(await holdsActiveName(pool, "0900000202"), false);
    assert.equal(await userForPhone(pool, "0900000202"), null);
    assert.equal((await activePhones(pool)).size, 0);
    assert.equal(await isAuthorizedPhone("0900000202", { fresh: true }), false);
    // back on the list: the same claim authorizes again
    await pool.query("UPDATE users SET active = true WHERE id = $1", [ids["DR:สมชาย"]]);
    assert.equal(await isAuthorizedPhone("0900000202", { fresh: true }), true);
  });

  test("first claim wins under concurrency; the others are told the name is taken", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => claimUser(pool, args(ids["DR:กมล"], `09000003${String(i).padStart(2, "0")}`, `U-race-${i}`))),
    );
    assert.equal(results.filter((r) => r.status === "claimed").length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.equal(results.filter((r) => r.status === "taken").length, 5);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM user_claims WHERE user_id = $1", [ids["DR:กมล"]]);
    assert.equal(rows[0].n, 1, "one claim recorded");
    const failed = await pool.query("SELECT count(*)::int AS n FROM login_events WHERE event = 'claim_failed'");
    assert.equal(failed.rows[0].n, 5, "lost attempts are counted");
  });

  test("one number claims one name, also when it races itself", async () => {
    const both = await Promise.all([
      claimUser(pool, args(ids["RN:ปราณี"], "0900000204", "U-b")),
      claimUser(pool, args(ids["RN:วิไล"], "0900000204", "U-b2")),
    ]);
    assert.deepEqual(both.map((r) => r.status).sort(), ["claimed", "phone_has_claim"]);
    const again = await claimUser(pool, args(ids["DR:ชัยวัฒน์"], "0900000204", "U-b"));
    assert.equal(again.status, "phone_has_claim");
    // a name someone else holds reads "taken" first, even for a number (and a LINE account) that holds a name
    assert.equal((await claimUser(pool, args(ids["DR:กมล"], "0900000219", "U-z"))).status, "claimed");
    assert.equal((await claimUser(pool, args(ids["DR:กมล"], "0900000204", "U-b"))).status, "taken");
  });

  test("a current claim on a deactivated user (e.g. a corrected spelling) is closed as 'inactive', without a block, when the person claims again", async () => {
    const old = await hold(ids["DR:เกษียณ"], "0900000205", "U-c");
    const before = await usersSnapshot();
    // a lost attempt changes nothing on the old claim
    await hold(ids["DR:กมล"], "0900000250", "U-c-other");
    assert.equal((await claimUser(pool, args(ids["DR:กมล"], "0900000205", "U-c"))).status, "taken");
    assert.equal((await getClaim(pool, old.rows[0].id))?.undoneAt, null, "kept after a failed claim");
    // the claim of the corrected name goes through, and is not blocked (no undo was needed)
    const r = await claimUser(pool, args(ids["DR:ชัยวัฒน์"], "0900000205", "U-c"));
    assert.equal(r.status, "claimed");
    const closed = await getClaim(pool, old.rows[0].id);
    assert.ok(closed?.undoneAt instanceof Date);
    assert.equal(closed?.undoReason, "inactive");
    assert.equal(closed?.undoneBy, null);
    assert.equal(await claimBlocked(pool, "0900000205", "U-c"), false, "'inactive' never blocks");
    assert.deepEqual(await userForPhone(pool, "0900000205"), r.status === "claimed" ? r.user : null);
    // the same for a LINE account whose only name went inactive
    await pool.query("UPDATE users SET active = false WHERE id = $1", [ids["DR:ชัยวัฒน์"]]);
    assert.equal((await claimUser(pool, args(ids["DR:สมชาย"], "0900000251", "U-c"))).status, "claimed");
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM user_claims WHERE line_sub = 'U-c' AND undone_at IS NULL");
    assert.equal(rows[0].n, 1);
    assert.equal(await claimBlocked(pool, "0900000251", "U-c"), false);
    // users was only read (the test's own deactivation aside)
    await pool.query("UPDATE users SET active = true WHERE id = $1", [ids["DR:ชัยวัฒน์"]]);
    const after = await usersSnapshot();
    assert.deepEqual(after.map((u) => [u.id, u.active]), before.map((u) => [u.id, u.active]));
  });

  test("one LINE account claims one name, also with a second verified number and when it races itself", async () => {
    const first = await claimUser(pool, args(ids["DR:สมชาย"], "0900000260", "U-two"));
    assert.equal(first.status, "claimed");
    const second = await claimUser(pool, args(ids["DR:กมล"], "0900000261", "U-two"));
    assert.equal(second.status, "line_has_claim");
    assert.equal(await current(ids["DR:กมล"]), null);
    const race = await Promise.all([
      claimUser(pool, args(ids["RN:ปราณี"], "0900000262", "U-race2")),
      claimUser(pool, args(ids["RN:วิไล"], "0900000263", "U-race2")),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), ["claimed", "line_has_claim"]);
  });

  test("the partial unique indexes: one current claim per user, per number and per LINE account; ended claims do not count", async () => {
    const code = (constraint: string) => (e: { code?: string; constraint?: string }) => e.code === "23505" && e.constraint === constraint;
    const a = await hold(ids["DR:สมชาย"], "0900000265", "U-idx");
    await assert.rejects(hold(ids["DR:สมชาย"], "0900000266", "U-idx2"), code("user_claims_current_user_key"));
    await assert.rejects(hold(ids["DR:กมล"], "0900000265", "U-idx2"), code("user_claims_current_phone_key"));
    await assert.rejects(hold(ids["DR:กมล"], "0900000266", "U-idx"), code("user_claims_current_line_sub_key"));
    await pool.query("UPDATE user_claims SET undone_at = now(), undo_reason = 'manual' WHERE id = $1", [a.rows[0].id]);
    await hold(ids["DR:สมชาย"], "0900000265", "U-idx");
    await assert.rejects(hold("999999", "0900000267", "U-idx3"), (e: { code?: string }) => e.code === "23503");
    await assert.rejects(hold(ids["DR:กมล"], "081-234-5678", "U-idx3"), (e: { code?: string }) => e.code === "23514");
    // an ended claim names its reason, and a current one has none
    await assert.rejects(
      pool.query("UPDATE user_claims SET undone_at = now() WHERE undone_at IS NULL"),
      (e: { code?: string }) => e.code === "23514",
    );
    await assert.rejects(
      pool.query("UPDATE user_claims SET undone_at = now(), undo_reason = 'oops' WHERE undone_at IS NULL"),
      (e: { code?: string }) => e.code === "23514",
    );
  });

  test("retrying one's own claim (another tab, a lost answer) signs in: no new claim, no attempt counted, the binding is kept", async () => {
    const r = await claimUser(pool, args(ids["DR:สมชาย"], "0900000270", "U-own"));
    assert.ok(r.status === "claimed");
    await pool.query("DELETE FROM line_bindings");
    const again = await claimUser(pool, args(ids["DR:สมชาย"], "0900000270", "U-own"));
    assert.equal(again.status, "own_claim");
    assert.ok(again.status === "own_claim" && again.user.id === ids["DR:สมชาย"]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_claims")).rows[0].n, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM login_events WHERE event = 'claim_failed'")).rows[0].n, 0);
    assert.equal((await pool.query("SELECT phone FROM line_bindings WHERE line_sub = 'U-own'")).rows[0]?.phone, "0900000270");
    // another number picking that name: taken
    assert.equal((await claimUser(pool, args(ids["DR:สมชาย"], "0900000271", "U-other"))).status, "taken");
  });

  test("a claim and an access request of one number exclude each other (in either order and at once)", async () => {
    const req = (phone: string, sub: string) =>
      createRequest(pool, { phone, sub, lineName: "x", firstName: "ทดสอบ", lastName: "ระบบ", position: "RN", ip: "203.0.113.7" });
    // claim first: the request is refused, the number signs in with its name
    assert.equal((await claimUser(pool, args(ids["DR:สมชาย"], "0900000280", "U-cr"))).status, "claimed");
    assert.deepEqual(await req("0900000280", "U-cr"), { status: "exists", view: "signin" });
    // request first: the claim is refused (pending, approved, recently rejected) and no attempt is counted
    const pending = await req("0900000281", "U-rc");
    assert.equal(pending.status, "created");
    assert.equal((await claimUser(pool, args(ids["DR:กมล"], "0900000281", "U-rc"))).status, "requested");
    assert.ok(pending.status === "created");
    await decideRequest(pool, pending.request.id, "approved", "111");
    assert.equal((await claimUser(pool, args(ids["DR:กมล"], "0900000281", "U-rc"))).status, "requested");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM login_events WHERE phone = '0900000281'")).rows[0].n, 0);
    // at once: exactly one goes through
    for (let i = 0; i < 4; i++) {
      await load();
      const phone = `09000002${90 + i}`;
      const [c, q] = await Promise.all([claimUser(pool, args(ids["RN:ปราณี"], phone, `U-x${i}`)), req(phone, `U-x${i}`)]);
      const claimed = c.status === "claimed";
      const requested = q.status === "created";
      assert.ok(claimed !== requested, `${c.status} / ${q.status}`);
      assert.equal(claimed ? q.status : c.status, claimed ? "exists" : "requested");
    }
  });

  test("inactive and unknown names are refused", async () => {
    assert.equal((await claimUser(pool, args(ids["DR:เกษียณ"], "0900000206", "U-d"))).status, "unavailable");
    assert.equal((await claimUser(pool, args("999999", "0900000206", "U-d"))).status, "unavailable");
    assert.equal(await current(ids["DR:เกษียณ"]), null);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM login_events WHERE event = 'claim_failed'")).rows[0].n, 2);
  });

  test(`rate limit: ${CLAIM_LIMITS.perSubDay} attempts per LINE account and ${CLAIM_LIMITS.perPhoneDay} per number in 24 h`, async () => {
    await hold(ids["DR:กมล"], "0900000299", "U-holder"); // taken
    for (let i = 0; i < CLAIM_LIMITS.perSubDay; i++) {
      assert.equal((await claimUser(pool, args(ids["DR:กมล"], `09000004${i}0`, "U-many"))).status, "taken");
    }
    const limited = await claimUser(pool, args(ids["DR:สมชาย"], "0900000499", "U-many"));
    assert.equal(limited.status, "limited", "even for a free name");
    assert.ok(limited.status === "limited" && limited.retryAfterS > 23 * 3600 && limited.retryAfterS <= 24 * 3600);
    // per number, across LINE accounts
    for (let i = 0; i < CLAIM_LIMITS.perPhoneDay; i++) {
      assert.equal((await claimUser(pool, args(ids["DR:กมล"], "0900000498", `U-acct-${i}`))).status, "taken");
    }
    assert.equal((await claimUser(pool, args(ids["DR:สมชาย"], "0900000498", "U-fresh"))).status, "limited");
    // older than 24 h: free again
    await pool.query("UPDATE login_events SET at = now() - interval '25 hours'");
    assert.equal((await claimUser(pool, args(ids["DR:สมชาย"], "0900000499", "U-many"))).status, "claimed");
  });

  test("undo ends the claim ('admin'), frees the name, deletes the number's LINE bindings and blocks a new claim by that number or account for 24 h", async () => {
    const r = await claimUser(pool, args(ids["DR:สมชาย"], "0900000207", "U-e"));
    assert.ok(r.status === "claimed");
    await upsertBinding(pool, "U-e", "0900000207", "LINE U-e");
    await upsertBinding(pool, "U-e-phone2", "0900000207", "second device");
    await upsertBinding(pool, "U-other", "0900000208", "someone else");
    const before = await usersSnapshot();
    const u = await undoClaim(pool, r.claim.id, "111");
    assert.equal(u.outcome, "undone");
    assert.ok(u.outcome === "undone");
    assert.equal(u.claim.undoneBy, "111");
    assert.equal(u.claim.undoReason, "admin");
    assert.ok(u.claim.undoneAt instanceof Date);
    assert.equal(u.user.firstName, "สมชาย");
    assert.deepEqual(await usersSnapshot(), before, "users is never written");
    assert.equal(await current(ids["DR:สมชาย"]), null);
    const b = await pool.query("SELECT line_sub FROM line_bindings ORDER BY line_sub");
    assert.deepEqual(b.rows.map((x) => x.line_sub), ["U-other"], "every binding of that number, only that number");
    assert.equal(await userForPhone(pool, "0900000207"), null);
    // the name is free for its real owner at once
    assert.equal((await listClaimable(pool, "DR")).find((n) => n.id === ids["DR:สมชาย"])?.claimed, false);
    // the undone number and LINE account cannot claim again for 24 h, any name
    assert.equal(await claimBlocked(pool, "0900000207", "U-x"), true);
    assert.equal(await claimBlocked(pool, "0900000209", "U-e"), true);
    assert.equal((await claimUser(pool, args(ids["DR:ชัยวัฒน์"], "0900000207", "U-new"))).status, "blocked");
    assert.equal((await claimUser(pool, args(ids["DR:ชัยวัฒน์"], "0900000209", "U-e"))).status, "blocked");
    assert.equal((await claimUser(pool, args(ids["DR:สมชาย"], "0900000210", "U-owner"))).status, "claimed", "others may claim");
    await pool.query("UPDATE user_claims SET undone_at = now() - interval '25 hours' WHERE id = $1", [r.claim.id]);
    assert.equal(await claimBlocked(pool, "0900000207", "U-e"), false);
    assert.equal((await claimUser(pool, args(ids["DR:ชัยวัฒน์"], "0900000207", "U-e"))).status, "claimed");
  });

  test("only an administrator's undo blocks: a claim released by hand ('manual') or closed as 'inactive' does not", async () => {
    const a = await hold(ids["DR:สมชาย"], "0900000217", "U-m");
    await pool.query("UPDATE user_claims SET undone_at = now(), undo_reason = 'manual' WHERE id = $1", [a.rows[0].id]);
    const b = await hold(ids["DR:กมล"], "0900000218", "U-n");
    await pool.query("UPDATE user_claims SET undone_at = now(), undo_reason = 'inactive' WHERE id = $1", [b.rows[0].id]);
    assert.equal(await claimBlocked(pool, "0900000217", "U-m"), false);
    assert.equal(await claimBlocked(pool, "0900000218", "U-n"), false);
    assert.equal((await claimUser(pool, args(ids["DR:สมชาย"], "0900000217", "U-m"))).status, "claimed");
    assert.equal((await claimUser(pool, args(ids["DR:กมล"], "0900000218", "U-n"))).status, "claimed");
  });

  test("undo: a second tap, concurrent taps, an unknown claim and an ended claim change nothing", async () => {
    const r = await claimUser(pool, args(ids["RN:ปราณี"], "0900000211", "U-f"));
    assert.ok(r.status === "claimed");
    const taps = await Promise.all([undoClaim(pool, r.claim.id, "111"), undoClaim(pool, r.claim.id, "222"), undoClaim(pool, r.claim.id, "111")]);
    assert.deepEqual(taps.map((t) => t.outcome).sort(), ["already", "already", "undone"]);
    assert.equal((await getClaim(pool, r.claim.id))?.undoneBy !== null, true);
    assert.equal((await undoClaim(pool, "987654", "111")).outcome, "missing");

    // released by hand and claimed again by someone else: the old message's button must not end the new claim
    const first = await claimUser(pool, args(ids["RN:วิไล"], "0900000212", "U-g"));
    assert.ok(first.status === "claimed");
    await pool.query("UPDATE user_claims SET undone_at = now(), undo_reason = 'manual' WHERE id = $1", [first.claim.id]);
    const second = await claimUser(pool, args(ids["RN:วิไล"], "0900000213", "U-h"));
    assert.ok(second.status === "claimed");
    const old = await undoClaim(pool, first.claim.id, "111");
    assert.equal(old.outcome, "already");
    assert.equal((await getClaim(pool, first.claim.id))?.undoReason, "manual", "the reason stays");
    assert.equal(await claimBlocked(pool, "0900000212", "U-g"), false, "no block from a tap on an ended claim");
    assert.deepEqual(await userForPhone(pool, "0900000213"), second.user, "the newer claim stands");
  });

  const TG = { TELEGRAM_BOT_TOKEN: "123456789:AAtestTOKENtestTOKENtestTOKEN_x-y", TELEGRAM_API_URL: "http://127.0.0.1:9" };
  function telegram(chatIds: string | null) {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_API_URL;
    if (chatIds !== null) Object.assign(process.env, TG, { TELEGRAM_CHAT_ID: chatIds });
  }

  test("claims are open only with Telegram and at least one numeric admin id; otherwise both claim endpoints send to the request", async () => {
    const grant = await signAccess({ sub: "U-off", name: "x", picture: null, phone: "0900000216" }, TEST_SESSION_SECRET);
    const cookie = `access=${grant}`;
    const post = (userId: unknown = Number(ids["DR:สมชาย"])) =>
      claimRoute(
        new NextRequest("http://localhost:3999/api/auth/claim", {
          method: "POST",
          headers: { cookie, origin: "http://localhost:3999", "content-type": "application/json" },
          body: JSON.stringify({ userId }),
        }),
      );
    const list = () => listRoute(new NextRequest("http://localhost:3999/api/auth/claim/list?type=DR", { headers: { cookie } }));
    try {
      // unset, only a group and a channel (nobody may tap undo), malformed
      for (const chats of [null, "-1001234567890, @orskh_alerts", "not a chat"]) {
        telegram(chats);
        assert.equal(claimsEnabled(), false, String(chats));
        for (const res of [await post(), await list()]) {
          assert.equal(res.status, 503, String(chats));
          assert.deepEqual(await res.json(), { error: MSG.claimsOff, reason: "claims_off", redirect: "/login/request" });
        }
      }
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_claims")).rows[0].n, 0, "nothing claimed");
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM login_events")).rows[0].n, 0, "no attempt counted");
      telegram("-1001234567890, 111");
      assert.equal(claimsEnabled(), true, "one person id is enough");
      assert.equal((await list()).status, 200);
      // ids outside users.id's range (an integer column), or not whole numbers, are refused before the database
      for (const bad of [2147483648, "2147483648", "99999999999", 0, -1, 1.5, "1; DROP TABLE users", "", null, "01"]) {
        const res = await post(bad);
        assert.equal(res.status, 400, JSON.stringify(bad));
        assert.equal((await res.json()).error, MSG.claimPick);
      }
      // a number with an access request goes to it (checked inside the claim transaction): 409 and the redirect
      await createRequest(pool, { phone: "0900000216", sub: "U-off", lineName: "x", firstName: "ทดสอบ", lastName: "ระบบ", position: "DR", ip: "" });
      const r = await post();
      assert.equal(r.status, 409);
      assert.deepEqual(await r.json(), { error: MSG.claimRequested, reason: "requested", redirect: "/login/request" });
    } finally {
      telegram(null);
    }
  });

  test("the claim-page list endpoint needs the access cookie, is never cached, and names no number or LINE id", async (t) => {
    telegram("111");
    t.after(() => telegram(null));
    await hold(ids["DR:กมล"], "0900000214", "U-hidden-sub");
    const url = "http://localhost:3999/api/auth/claim/list?type=DR";
    const none = await listRoute(new NextRequest(url));
    assert.equal(none.status, 401);
    const forged = await listRoute(new NextRequest(url, { headers: { cookie: "access=not-a-token" } }));
    assert.equal(forged.status, 401);
    const grant = await signAccess({ sub: "U-viewer", name: "x", picture: null, phone: "0900000215" }, TEST_SESSION_SECRET);
    const ok = await listRoute(new NextRequest(url, { headers: { cookie: `access=${grant}` } }));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    const text = await ok.text();
    assert.ok(!text.includes("0900000214") && !text.includes("U-hidden-sub") && !/0[689]\d{8}/.test(text), text);
    const body = JSON.parse(text) as { type: string; names: Record<string, unknown>[] };
    assert.equal(body.type, "DR");
    assert.deepEqual(
      body.names.map((n) => [n.first_name, n.subtype_label, n.claimed]),
      [
        ["กมล", "สูติ-นรีเวชกรรม", true],
        ["ชัยวัฒน์", subtypeLabel("DR", "NEURO"), false],
        ["สมชาย", "ออร์โธปิดิกส์", false],
      ],
    );
    for (const n of body.names) assert.deepEqual(Object.keys(n).sort(), ["claimed", "first_name", "id", "last_name", "subtype", "subtype_label"]);
    for (const bad of ["", "dr", "doctor", "__proto__"]) {
      const r = await listRoute(new NextRequest(`http://localhost:3999/api/auth/claim/list?type=${bad}`, { headers: { cookie: `access=${grant}` } }));
      assert.equal(r.status, 400, bad);
    }
  });
});
