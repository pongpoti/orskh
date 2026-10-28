import "./_setup";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import {
  codeMatches,
  findFreshBinding,
  generateCode,
  hashCode,
  LIMITS,
  logEvent,
  MAX_ATTEMPTS,
  requestCode,
  resetVolumeAlert,
  upsertBinding,
  verifyCode,
  VOLUME_ALERT_PER_DAY,
  volumeAlertDue,
} from "@/lib/otp";
import { TEST_DB, TEST_PEPPER as PEPPER } from "./_setup";

describe("OTP hashing", () => {
  test("codes are 6 digits, uniformly formatted (leading zeros kept)", () => {
    for (let i = 0; i < 2000; i++) assert.match(generateCode(), /^\d{6}$/);
  });

  test("HMAC binds pepper, email, LINE sub and code", () => {
    const h = hashCode(PEPPER, "a@example.com", "U1", "123456");
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.notEqual(h, "123456");
    assert.equal(h, hashCode(PEPPER, "a@example.com", "U1", "123456"));
    assert.notEqual(h, hashCode(`${PEPPER}x`, "a@example.com", "U1", "123456"));
    assert.notEqual(h, hashCode(PEPPER, "b@example.com", "U1", "123456"));
    assert.notEqual(h, hashCode(PEPPER, "a@example.com", "U2", "123456"));
    assert.notEqual(h, hashCode(PEPPER, "a@example.com", "U1", "123457"));
    assert.equal(codeMatches(PEPPER, "a@example.com", "U1", "123456", h), true);
    assert.equal(codeMatches(PEPPER, "a@example.com", "U1", "654321", h), false);
    assert.equal(codeMatches(PEPPER, "a@example.com", "U1", "123456", "deadbeef"), false);
  });
});

describe("OTP rate limits and attempts (database)", () => {
  const pool = createPool(TEST_DB);
  const email = "doc2@example.com";
  const sub = "Usub-1";
  const ip = "203.0.113.1";

  before(async () => {
    await pool.query("DROP TABLE IF EXISTS otp_codes, line_bindings, login_events");
    await ensureSchema(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE otp_codes, line_bindings, login_events RESTART IDENTITY");
  });
  after(() => pool.end());

  const req = (o: Partial<{ email: string; sub: string; ip: string }> = {}) =>
    requestCode(pool, { email, sub, ip, pepper: PEPPER, ...o });
  const age = (seconds: number) =>
    pool.query(
      `UPDATE otp_codes SET created_at = created_at - make_interval(secs => $1),
                            expires_at = expires_at - make_interval(secs => $1)`,
      [seconds],
    );
  async function issue(o: Parameters<typeof req>[0] = {}): Promise<string> {
    const r = await req(o);
    assert.equal(r.status, "issued");
    assert.ok(r.status === "issued" && r.code);
    return r.code as string;
  }

  test("stores only the HMAC (no plaintext code anywhere in the row)", async () => {
    const code = await issue();
    const { rows } = await pool.query("SELECT row_to_json(o)::text AS j, code_hash FROM otp_codes o");
    assert.equal(rows.length, 1);
    assert.ok(!rows[0].j.includes(`"${code}"`));
    assert.equal(rows[0].code_hash, hashCode(PEPPER, email, sub, code));
  });

  test("any valid email gets a real, verifiable code (no decoys)", async () => {
    const code = await issue({ email: "newcomer@example.com" });
    const wrong = code === "000000" ? "111111" : "000000";
    const v = await verifyCode(pool, { email: "newcomer@example.com", sub, code: wrong, pepper: PEPPER });
    assert.deepEqual(v, { ok: false, reason: "invalid", remaining: 4 });
    assert.deepEqual(await verifyCode(pool, { email: "newcomer@example.com", sub, code, pepper: PEPPER }), { ok: true });
  });

  test("60 s cooldown per email + LINE sub", async () => {
    await issue();
    const r = await req();
    assert.equal(r.status, "limited");
    assert.ok(r.status === "limited" && r.reason === "cooldown" && r.retryAfterS > 0 && r.retryAfterS <= 60);
    await issue({ sub: "Uother" }); // different LINE account is not affected by this cooldown
    await age(61);
    await issue();
  });

  test("max 3 sends per email per 15 minutes", async () => {
    for (let i = 0; i < 3; i++) await issue({ sub: `Us${i}`, ip: `198.51.100.${i}` });
    const r = await req({ sub: "Us9", ip: "198.51.100.9" });
    assert.ok(r.status === "limited" && r.reason === "email");
    await age(15 * 60 + 1);
    await issue({ sub: "Us9", ip: "198.51.100.9" });
  });

  test("max 6 codes per address per LINE account per 24 h; other accounts' requests never lock it out", async () => {
    assert.equal(LIMITS.perPairDay, 6);
    // Six codes for one address from one account, spaced past the cooldown, 15-minute and hourly limits.
    for (let i = 0; i < 6; i++) {
      await issue();
      await age(i === 2 ? 15 * 60 + 1 : i === 4 ? 3601 : 61);
    }
    const r = await req();
    assert.ok(r.status === "limited" && r.reason === "pair_day", JSON.stringify(r));
    assert.ok(r.retryAfterS > 22 * 3600 && r.retryAfterS < 24 * 3600, `retry after the oldest leaves the window: ${r.retryAfterS}`);
    await issue({ sub: "Uowner", ip: "198.51.100.9" }); // the address's owner, on another LINE account, still gets a code
    await age(24 * 3600);
    await issue();
  });

  test("max 5 sends per LINE sub per hour", async () => {
    for (const e of ["e0", "e1", "e2"]) await issue({ email: `${e}@example.com`, ip: "198.51.100.1" });
    await age(61);
    for (const e of ["e0", "e1"]) await issue({ email: `${e}@example.com`, ip: "198.51.100.1" });
    const r = await req({ email: "e2@example.com", ip: "198.51.100.9" });
    assert.ok(r.status === "limited" && r.reason === "sub", JSON.stringify(r));
    await age(3601);
    await issue({ email: "e2@example.com", ip: "198.51.100.9" });
  });

  test("at most 5 different addresses per LINE sub per 24 h (listed or not); those 5 can be asked again", async () => {
    assert.equal(LIMITS.emailsPerSubDay, 5);
    for (const e of ["a1@example.com", "doc.one@example.com", "a3@example.com", "a4@example.com", "a5@example.com"]) {
      await issue({ email: e });
    }
    await age(3601); // past the hourly limit of the LINE account
    for (const e of ["a6@example.com", "third@example.com"]) {
      const r = await req({ email: e });
      assert.ok(r.status === "limited" && r.reason === "sub_emails", `${e}: ${JSON.stringify(r)}`);
      assert.ok(r.retryAfterS > 22 * 3600, `${r.retryAfterS}`);
    }
    await issue({ email: "a1@example.com" }); // an address this account already used
    await issue({ email: "a6@example.com", sub: "Uother" }); // other LINE accounts are not affected
    await age(3600 * 2);
    assert.equal((await req({ email: "a6@example.com" })).status, "limited", "still within 24 h");
    await age(21 * 3600);
    await issue({ email: "a6@example.com" });
  });

  test("the hourly IP limit counts only the last hour, also for rows found through the email or LINE sub", async () => {
    const insert = (e: string, sb: string, ago: string) =>
      pool.query(
        `INSERT INTO otp_codes (email, line_sub, code_hash, created_at, expires_at, ip)
         VALUES ($1, $2, 'x', now() - $3::interval, now() - $3::interval, $4)`,
        [e, sb, ago, ip],
      );
    for (const e of ["s1@example.com", "s1@example.com", "s1@example.com", "s2@example.com", "s2@example.com"]) {
      await insert(e, sub, "2 hours");
    }
    for (let i = 0; i < 15; i++) await insert(`r${i}@example.com`, `Ur${i}`, "1 minute");
    const r = await req({ email: "s1@example.com" });
    assert.equal(r.status, "issued", JSON.stringify(r));
  });

  test("counts every code mailed in the last 24 h (all addresses) for the volume alert", async () => {
    const a = await req();
    assert.ok(a.status === "issued" && a.sentToday === 1);
    const b = await req({ email: "x@example.com", sub: "Ux", ip: "192.0.2.9" });
    assert.ok(b.status === "issued" && b.sentToday === 2);
    await age(24 * 3600 + 1);
    const c = await req({ sub: "Uy" });
    assert.ok(c.status === "issued" && c.sentToday === 1, JSON.stringify(c));
  });

  test("max 20 sends per IP per hour", async () => {
    for (let i = 0; i < 20; i++) {
      const r = await req({ email: `ip${i}@example.com`, sub: `Uip${i}` });
      assert.equal(r.status, "issued");
    }
    const r = await req({ email: "ipx@example.com", sub: "Uipx" });
    assert.ok(r.status === "limited" && r.reason === "ip");
    await issue({ email: "ipx@example.com", sub: "Uipx", ip: "192.0.2.77" });
  });

  test("concurrent sends cannot exceed the per-email limit", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => req({ sub: `Uc${i}`, ip: `192.0.2.${i}` })),
    );
    assert.equal(results.filter((r) => r.status === "issued").length, 3);
  });

  test("correct code signs in once (single use)", async () => {
    const code = await issue();
    assert.deepEqual(await verifyCode(pool, { email, sub, code, pepper: PEPPER }), { ok: true });
    assert.deepEqual(await verifyCode(pool, { email, sub, code, pepper: PEPPER }), { ok: false, reason: "expired" });
  });

  test("code is bound to the LINE sub that requested it", async () => {
    const code = await issue();
    assert.deepEqual(await verifyCode(pool, { email, sub: "Uattacker", code, pepper: PEPPER }), {
      ok: false,
      reason: "expired",
    });
    assert.deepEqual(await verifyCode(pool, { email, sub, code, pepper: PEPPER }), { ok: true });
  });

  test("5 wrong guesses kill the code, even the right code afterwards", async () => {
    const code = await issue();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      assert.deepEqual(await verifyCode(pool, { email, sub, code: wrong, pepper: PEPPER }), {
        ok: false,
        reason: "invalid",
        remaining: MAX_ATTEMPTS - i,
      });
    }
    assert.deepEqual(await verifyCode(pool, { email, sub, code: wrong, pepper: PEPPER }), { ok: false, reason: "locked" });
    assert.deepEqual(await verifyCode(pool, { email, sub, code, pepper: PEPPER }), { ok: false, reason: "locked" });
    const { rows } = await pool.query("SELECT attempts, used_at FROM otp_codes");
    assert.equal(rows[0].attempts, MAX_ATTEMPTS);
    assert.equal(rows[0].used_at, null);
  });

  test("concurrent guesses never exceed 5 attempts", async () => {
    const code = await issue();
    const wrong = code === "000000" ? "111111" : "000000";
    const results = await Promise.all(
      Array.from({ length: 25 }, () => verifyCode(pool, { email, sub, code: wrong, pepper: PEPPER })),
    );
    const { rows } = await pool.query("SELECT attempts FROM otp_codes");
    assert.equal(rows[0].attempts, MAX_ATTEMPTS);
    const counted = results.filter((r) => !r.ok && (r.reason === "invalid" || r.reason === "locked")).length;
    assert.equal(counted, 25);
    assert.equal(results.filter((r) => !r.ok && r.reason === "invalid").length, MAX_ATTEMPTS - 1);
  });

  test("concurrent correct submissions succeed exactly once", async () => {
    const code = await issue();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => verifyCode(pool, { email, sub, code, pepper: PEPPER })),
    );
    assert.equal(results.filter((r) => r.ok).length, 1);
  });

  test("a new code invalidates older unused codes", async () => {
    const first = await issue();
    await age(61);
    const second = await issue();
    if (first !== second) {
      const v = await verifyCode(pool, { email, sub, code: first, pepper: PEPPER });
      assert.equal(v.ok, false);
    }
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM otp_codes WHERE expires_at > now()");
    assert.equal(rows[0].n, 1);
    assert.deepEqual(await verifyCode(pool, { email, sub, code: second, pepper: PEPPER }), { ok: true });
  });

  test("expired codes are rejected", async () => {
    const code = await issue();
    await pool.query("UPDATE otp_codes SET expires_at = now() - interval '1 second'");
    assert.deepEqual(await verifyCode(pool, { email, sub, code, pepper: PEPPER }), { ok: false, reason: "expired" });
  });

  test("LINE bindings are fresh for 180 days", async () => {
    assert.equal(await findFreshBinding(pool, sub), null);
    await upsertBinding(pool, sub, email, "หมอ");
    assert.equal((await findFreshBinding(pool, sub))?.email, email);
    await upsertBinding(pool, sub, "third@example.com", "หมอ");
    assert.equal((await findFreshBinding(pool, sub))?.email, "third@example.com");
    await pool.query("UPDATE line_bindings SET verified_at = now() - interval '181 days'");
    assert.equal(await findFreshBinding(pool, sub), null);
  });

  test("login events are recorded", async () => {
    await logEvent(pool, { event: "login_otp", sub, email, ip, userAgent: "ua" });
    const { rows } = await pool.query("SELECT event, line_sub, email, ip, user_agent FROM login_events");
    assert.deepEqual(rows, [{ event: "login_otp", line_sub: sub, email, ip, user_agent: "ua" }]);
  });
});

describe("code volume alert", () => {
  test("due once the 24 h count reaches the threshold, then at most every 6 hours per instance", () => {
    resetVolumeAlert();
    const t0 = Date.UTC(2026, 9, 25, 9, 0);
    const hour = 3600_000;
    assert.equal(volumeAlertDue(VOLUME_ALERT_PER_DAY - 1, t0), false);
    assert.equal(volumeAlertDue(VOLUME_ALERT_PER_DAY, t0), true);
    assert.equal(volumeAlertDue(VOLUME_ALERT_PER_DAY + 40, t0 + hour), false, "not again within 6 h");
    assert.equal(volumeAlertDue(VOLUME_ALERT_PER_DAY + 40, t0 + 6 * hour), true);
    assert.ok(VOLUME_ALERT_PER_DAY < 500 / 2, "well below a Gmail account's daily quota");
    resetVolumeAlert();
  });
});
