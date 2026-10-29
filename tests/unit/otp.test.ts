import "./_setup";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import {
  CODE_TTL_MIN,
  codeMatches,
  findFreshBinding,
  generateCode,
  hashCode,
  hasLiveCode,
  LIMITS,
  logEvent,
  MAX_ATTEMPTS,
  sendCode,
  upsertBinding,
  verifyCode,
  type CheckResult,
  type IssueResult,
  type OtpTransport,
} from "@/lib/otp";
import { smsTransport } from "@/lib/sms";
import { TEST_DB, TEST_PEPPER as PEPPER } from "./_setup";

/** Runs fn with console.error silenced (expected failure logs). */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
}

/**
 * Local-mode transport that hands the code to the test instead of writing a file; `issueWith` / `checkWith` replace
 * the answer (a provider failure, a provider verdict).
 */
function fakeTransport() {
  const sent: { phone: string; code: string; ref: string }[] = [];
  const state: {
    issueWith: (() => IssueResult | Promise<IssueResult>) | null;
    checkWith: (() => CheckResult | Promise<CheckResult>) | null;
    checks: number;
  } = { issueWith: null, checkWith: null, checks: 0 };
  const transport: OtpTransport = {
    async issue({ phone, sub, pepper }) {
      if (state.issueWith) return state.issueWith();
      const code = generateCode();
      const ref = `R${sent.length.toString().padStart(3, "0")}`;
      sent.push({ phone, code, ref });
      return { ok: true, ref, stored: { codeHash: hashCode(pepper, phone, sub, code), providerToken: null }, creditBalance: null };
    },
    async check({ phone, sub, pepper, code, stored }) {
      state.checks += 1;
      if (state.checkWith) return state.checkWith();
      return stored.codeHash && codeMatches(pepper, phone, sub, code, stored.codeHash)
        ? { ok: true }
        : { ok: false, reason: "wrong", providerCode: null };
    },
  };
  return { transport, sent, state };
}

describe("OTP hashing", () => {
  test("codes are 6 digits, uniformly formatted (leading zeros kept)", () => {
    for (let i = 0; i < 2000; i++) assert.match(generateCode(), /^\d{6}$/);
  });

  test("HMAC binds pepper, phone, LINE sub and code", () => {
    const h = hashCode(PEPPER, "0900000001", "U1", "123456");
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.notEqual(h, "123456");
    assert.equal(h, hashCode(PEPPER, "0900000001", "U1", "123456"));
    assert.notEqual(h, hashCode(`${PEPPER}x`, "0900000001", "U1", "123456"));
    assert.notEqual(h, hashCode(PEPPER, "0900000003", "U1", "123456"));
    assert.notEqual(h, hashCode(PEPPER, "0900000001", "U2", "123456"));
    assert.notEqual(h, hashCode(PEPPER, "0900000001", "U1", "123457"));
    assert.equal(codeMatches(PEPPER, "0900000001", "U1", "123456", h), true);
    assert.equal(codeMatches(PEPPER, "0900000001", "U1", "654321", h), false);
    assert.equal(codeMatches(PEPPER, "0900000001", "U1", "123456", "deadbeef"), false);
  });
});

describe("OTP rate limits and attempts (database)", () => {
  const pool = createPool(TEST_DB);
  const phone = "0900000002";
  const sub = "Usub-1";
  const ip = "203.0.113.1";
  const CAP = 300;
  let fake = fakeTransport();

  before(async () => {
    await pool.query("DROP TABLE IF EXISTS otp_codes, line_bindings, login_events, user_claims, users, access_requests");
    await ensureSchema(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE otp_codes, line_bindings, login_events RESTART IDENTITY");
    fake = fakeTransport();
  });
  after(() => pool.end());

  const req = (o: Partial<{ phone: string; sub: string; ip: string; dailyCap: number; transport: OtpTransport }> = {}) =>
    sendCode(pool, { phone, sub, ip, pepper: PEPPER, dailyCap: CAP, transport: fake.transport, ...o });
  /** The real deeSMSX transport over a stand-in fetch. */
  const deesmsx = (f: typeof fetch, timeoutMs?: number) =>
    smsTransport(
      {
        kind: "deesmsx",
        apiKey: "k",
        secretKey: "s",
        sender: "deeSMS.OTP",
        apiUrl: "https://sms.test/v1",
        outboxDir: "",
        dailyCap: CAP,
      },
      { fetch: f, timeoutMs },
    );
  const verify = (o: Partial<{ phone: string; sub: string; code: string }> & { code: string }) =>
    verifyCode(pool, { phone, sub, pepper: PEPPER, transport: fake.transport, ...o });
  const age = (seconds: number) =>
    pool.query(
      `UPDATE otp_codes SET created_at = created_at - make_interval(secs => $1),
                            expires_at = expires_at - make_interval(secs => $1)`,
      [seconds],
    );
  async function issue(o: Parameters<typeof req>[0] = {}): Promise<string> {
    const r = await req(o);
    assert.equal(r.status, "sent", JSON.stringify(r));
    return fake.sent[fake.sent.length - 1].code;
  }

  test("stores only the HMAC and the ref (no plaintext code anywhere in the row); lives 5 minutes", async () => {
    const r = await req();
    assert.ok(r.status === "sent" && r.ref === "R000" && r.sentToday === 1);
    const code = fake.sent[0].code;
    const { rows } = await pool.query(
      "SELECT row_to_json(o)::text AS j, code_hash, provider_token, ref, extract(epoch FROM expires_at - created_at)::int AS ttl FROM otp_codes o",
    );
    assert.equal(rows.length, 1);
    assert.ok(!rows[0].j.includes(`"${code}"`));
    assert.equal(rows[0].code_hash, hashCode(PEPPER, phone, sub, code));
    assert.equal(rows[0].provider_token, null);
    assert.equal(rows[0].ref, "R000");
    assert.equal(CODE_TTL_MIN, 5);
    assert.ok(Math.abs(rows[0].ttl - 300) <= 2, `ttl ${rows[0].ttl}`);
  });

  test("any valid number gets a real, verifiable code (no decoys)", async () => {
    const code = await issue({ phone: "0811111111" });
    const wrong = code === "000000" ? "111111" : "000000";
    assert.deepEqual(await verify({ phone: "0811111111", code: wrong }), { ok: false, reason: "invalid", remaining: 4 });
    assert.deepEqual(await verify({ phone: "0811111111", code }), { ok: true });
  });

  test("a send that certainly failed leaves no row: it costs no quota and the cooldown does not start", async () => {
    for (const reason of ["failed", "no_credit", "misconfigured", "invalid_number"] as const) {
      fake.state.issueWith = () => ({ ok: false, reason, providerCode: null });
      const r = await req();
      assert.deepEqual(r, { status: "failed", reason, providerCode: null });
    }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM otp_codes")).rows[0].n, 0);
    fake.state.issueWith = null;
    await issue(); // at once: no cooldown, no 15-minute count from the failures
  });

  test("deeSMSX's documented refusals and a request that never left release the reservation", async () => {
    const answers: (() => Promise<Response>)[] = [
      async () => Response.json({ code: "99", status: "500" }, { status: 500 }),
      async () => Response.json({ code: "9", status: "500" }, { status: 500 }),
      async () => Response.json({ error: "100", status: "163" }),
      async () => Response.json({ code: "102", status: "166" }),
      async () => Response.json({ code: "204", status: "500" }, { status: 500 }),
      async () => {
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) });
      },
      async () => {
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("dns"), { code: "ENOTFOUND" }) });
      },
    ];
    let calls = 0;
    for (const answer of answers) {
      const transport = deesmsx((async () => (calls++, answer())) as typeof fetch);
      const r = await quiet(() => req({ transport }));
      assert.equal(r.status, "failed", JSON.stringify(r));
      assert.notEqual(r.status === "failed" && r.reason, "uncertain", JSON.stringify(r));
    }
    assert.equal(calls, answers.length, "each one reached the provider: no cooldown in between");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM otp_codes")).rows[0].n, 0);
  });

  test("a send that may have gone out keeps its row: it counts for the cooldown, every limit and the cap", async () => {
    // A timeout after the request left, a gateway's HTML 504, 101, an unknown code, success without a token.
    const answers: [string, (init?: RequestInit) => Promise<Response>][] = [
      [
        "timeout",
        (init) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ],
      ["HTML 504", async () => new Response("<html><body>504 Gateway Time-out</body></html>", { status: 504 })],
      ["101", async () => Response.json({ code: "101", status: "166", msg: "Unsuccess" })],
      ["unknown code", async () => Response.json({ code: "777" })],
      ["success without token", async () => Response.json({ error: "0", status: "200", result: { ref: "9N14" } })],
      ["socket reset", async () => Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }))],
    ];
    for (const [name, answer] of answers) {
      await pool.query("TRUNCATE otp_codes");
      let calls = 0;
      const transport = deesmsx(((_u: unknown, init?: RequestInit) => (calls++, answer(init))) as typeof fetch, 30);
      const keepAlive = setTimeout(() => {}, 5000); // AbortSignal.timeout does not keep the process alive
      const first = await quiet(() => req({ transport }));
      clearTimeout(keepAlive);
      assert.deepEqual(first.status === "failed" && first.reason, "uncertain", `${name}: ${JSON.stringify(first)}`);
      // The next tap is held back by the 60 s cooldown: the provider is not asked again.
      const second = await quiet(() => req({ transport }));
      assert.ok(second.status === "limited" && second.reason === "cooldown", `${name}: ${JSON.stringify(second)}`);
      assert.equal(calls, 1, name);
      const { rows } = await pool.query("SELECT code_hash, provider_token, expires_at <= created_at AS dead FROM otp_codes");
      assert.equal(rows.length, 1, name);
      assert.deepEqual(rows[0], { code_hash: null, provider_token: null, dead: true }, name);
      assert.equal(await hasLiveCode(pool, phone, sub), false, `${name}: the kept row can never be verified`);
      assert.deepEqual(await verify({ code: "123456" }), { ok: false, reason: "expired" }, name);
    }
  });

  test("uncertain sends count for the per-number limit and the daily cap; a thrown transport is uncertain too", async () => {
    fake.state.issueWith = () => ({ ok: false, reason: "uncertain", providerCode: null });
    for (let i = 0; i < 3; i++) {
      const r = await req({ sub: `Uu${i}`, ip: `198.51.100.${i}` });
      assert.ok(r.status === "failed" && r.reason === "uncertain", JSON.stringify(r));
    }
    const r = await req({ sub: "Uu9", ip: "198.51.100.9" });
    assert.ok(r.status === "limited" && r.reason === "phone", JSON.stringify(r));

    await pool.query("TRUNCATE otp_codes");
    fake.state.issueWith = () => {
      throw new Error("socket hang up");
    };
    const thrown = await quiet(() => req({ dailyCap: 2 }));
    assert.deepEqual(thrown, { status: "failed", reason: "uncertain", providerCode: null });
    fake.state.issueWith = () => ({ ok: false, reason: "uncertain", providerCode: 101 });
    assert.equal((await req({ phone: "0611111111", sub: "Uz", ip: "192.0.2.50", dailyCap: 2 })).status, "failed");
    const capped = await req({ phone: "0900000001", sub: "Uy", ip: "192.0.2.51", dailyCap: 2 });
    assert.ok(capped.status === "capped" && capped.sentToday === 2, JSON.stringify(capped));
  });

  test("a failed or uncertain resend keeps the previous code working", async () => {
    const first = await issue();
    await age(61);
    fake.state.issueWith = () => ({ ok: false, reason: "failed", providerCode: null });
    assert.equal((await req()).status, "failed");
    fake.state.issueWith = () => ({ ok: false, reason: "uncertain", providerCode: 101 });
    assert.equal((await req()).status, "failed");
    assert.equal(await hasLiveCode(pool, phone, sub), true);
    assert.deepEqual(await verify({ code: first }), { ok: true });
    assert.equal(await hasLiveCode(pool, phone, sub), false, "used");
  });

  test("hasLiveCode: only an unused, unexpired code with attempts left, for this number and LINE account", async () => {
    assert.equal(await hasLiveCode(pool, phone, sub), false);
    const code = await issue();
    assert.equal(await hasLiveCode(pool, phone, sub), true);
    assert.equal(await hasLiveCode(pool, phone, "Uother"), false);
    assert.equal(await hasLiveCode(pool, "0611111111", sub), false);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_ATTEMPTS; i++) await verify({ code: wrong });
    assert.equal(await hasLiveCode(pool, phone, sub), false, "locked");
    await age(61);
    await issue();
    await age(CODE_TTL_MIN * 60 + 1);
    assert.equal(await hasLiveCode(pool, phone, sub), false, "expired");
  });

  test("60 s cooldown per number + LINE sub, also while the SMS is still being sent", async () => {
    await issue();
    const r = await req();
    assert.equal(r.status, "limited");
    assert.ok(r.status === "limited" && r.reason === "cooldown" && r.retryAfterS > 0 && r.retryAfterS <= 60);
    await issue({ sub: "Uother" }); // different LINE account is not affected by this cooldown
    await age(61);
    // two requests at once (a double tap): the first one's reservation blocks the second
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fake.state.issueWith = async () => {
      await gate;
      fake.state.issueWith = null;
      return fake.transport.issue({ phone, sub, pepper: PEPPER });
    };
    const slow = req();
    await new Promise((r) => setTimeout(r, 50));
    const second = await req();
    assert.ok(second.status === "limited" && second.reason === "cooldown", JSON.stringify(second));
    release();
    assert.equal((await slow).status, "sent");
  });

  test("max 3 sends per number per 15 minutes", async () => {
    for (let i = 0; i < 3; i++) await issue({ sub: `Us${i}`, ip: `198.51.100.${i}` });
    const r = await req({ sub: "Us9", ip: "198.51.100.9" });
    assert.ok(r.status === "limited" && r.reason === "phone");
    await age(15 * 60 + 1);
    await issue({ sub: "Us9", ip: "198.51.100.9" });
  });

  test("max 6 codes per number per LINE account per 24 h; other accounts' requests never lock it out", async () => {
    assert.equal(LIMITS.perPairDay, 6);
    // Six codes for one number from one account, spaced past the cooldown, 15-minute and hourly limits.
    for (let i = 0; i < 6; i++) {
      await issue();
      await age(i === 2 ? 15 * 60 + 1 : i === 4 ? 3601 : 61);
    }
    const r = await req();
    assert.ok(r.status === "limited" && r.reason === "pair_day", JSON.stringify(r));
    assert.ok(r.retryAfterS > 22 * 3600 && r.retryAfterS < 24 * 3600, `retry after the oldest leaves the window: ${r.retryAfterS}`);
    await issue({ sub: "Uowner", ip: "198.51.100.9" }); // the number's owner, on another LINE account, still gets a code
    await age(24 * 3600);
    await issue();
  });

  test("max 5 sends per LINE sub per hour", async () => {
    for (const p of ["0800000000", "0800000001", "0800000002"]) await issue({ phone: p, ip: "198.51.100.1" });
    await age(61);
    for (const p of ["0800000000", "0800000001"]) await issue({ phone: p, ip: "198.51.100.1" });
    const r = await req({ phone: "0800000002", ip: "198.51.100.9" });
    assert.ok(r.status === "limited" && r.reason === "sub", JSON.stringify(r));
    await age(3601);
    await issue({ phone: "0800000002", ip: "198.51.100.9" });
  });

  test("at most 5 different numbers per LINE sub per 24 h (listed or not); those 5 can be asked again", async () => {
    assert.equal(LIMITS.phonesPerSubDay, 5);
    for (const p of ["0810000001", "0812345678", "0810000003", "0810000004", "0810000005"]) {
      await issue({ phone: p });
    }
    await age(3601); // past the hourly limit of the LINE account
    for (const p of ["0810000006", "0611111111"]) {
      const r = await req({ phone: p });
      assert.ok(r.status === "limited" && r.reason === "sub_phones", `${p}: ${JSON.stringify(r)}`);
      assert.ok(r.retryAfterS > 22 * 3600, `${r.retryAfterS}`);
    }
    await issue({ phone: "0810000001" }); // a number this account already used
    await issue({ phone: "0810000006", sub: "Uother" }); // other LINE accounts are not affected
    await age(3600 * 2);
    assert.equal((await req({ phone: "0810000006" })).status, "limited", "still within 24 h");
    await age(21 * 3600);
    await issue({ phone: "0810000006" });
  });

  test("the hourly IP limit counts only the last hour, also for rows found through the number or LINE sub", async () => {
    const insert = (p: string, sb: string, ago: string) =>
      pool.query(
        `INSERT INTO otp_codes (phone, line_sub, code_hash, created_at, expires_at, ip)
         VALUES ($1, $2, 'x', now() - $3::interval, now() - $3::interval, $4)`,
        [p, sb, ago, ip],
      );
    for (const p of ["0820000001", "0820000001", "0820000001", "0820000002", "0820000002"]) {
      await insert(p, sub, "2 hours");
    }
    for (let i = 0; i < 15; i++) await insert(`08300000${String(i).padStart(2, "0")}`, `Ur${i}`, "1 minute");
    const r = await req({ phone: "0820000001" });
    assert.equal(r.status, "sent", JSON.stringify(r));
  });

  test("max 20 sends per IP per hour", async () => {
    for (let i = 0; i < 20; i++) {
      const r = await req({ phone: `08400000${String(i).padStart(2, "0")}`, sub: `Uip${i}` });
      assert.equal(r.status, "sent");
    }
    const r = await req({ phone: "0840000099", sub: "Uipx" });
    assert.ok(r.status === "limited" && r.reason === "ip");
    await issue({ phone: "0840000099", sub: "Uipx", ip: "192.0.2.77" });
  });

  test("SMS_DAILY_CAP: no SMS once the cap is reached across all numbers in 24 h; frees up as rows age out", async () => {
    const cap = 4;
    for (let i = 0; i < cap; i++) {
      const r = await req({ phone: `08500000${i}0`, sub: `Ucap${i}`, ip: `192.0.2.${i}`, dailyCap: cap });
      assert.ok(r.status === "sent" && r.sentToday === i + 1, JSON.stringify(r));
    }
    const sentBefore = fake.sent.length;
    const r = await req({ phone: "0850000099", sub: "Ucapx", ip: "192.0.2.99", dailyCap: cap });
    assert.ok(r.status === "capped" && r.sentToday === cap, JSON.stringify(r));
    assert.ok(r.status === "capped" && r.retryAfterS > 23 * 3600, "until the oldest leaves the window");
    assert.equal(fake.sent.length, sentBefore, "the provider is not called");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM otp_codes")).rows[0].n, cap, "nothing reserved");
    // a number that already got a code, from another account, is capped too: the cap protects the credit, whoever asks
    const again = await req({ phone: "0850000000", sub: "Ucapy", ip: "192.0.2.98", dailyCap: cap });
    assert.equal(again.status, "capped");
    await age(24 * 3600 + 1);
    assert.equal((await req({ phone: "0850000099", sub: "Ucapx", ip: "192.0.2.99", dailyCap: cap })).status, "sent");
  });

  test("the cap holds under concurrency (all sends are serialized while counting)", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        req({ phone: `08600000${String(i).padStart(2, "0")}`, sub: `Ucc${i}`, ip: `192.0.2.${i}`, dailyCap: 5 }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "sent").length, 5);
    assert.equal(results.filter((r) => r.status === "capped").length, 7);
  });

  test("counts every code sent in the last 24 h (all numbers) for the volume alert", async () => {
    const a = await req();
    assert.ok(a.status === "sent" && a.sentToday === 1);
    const b = await req({ phone: "0870000001", sub: "Ux", ip: "192.0.2.9" });
    assert.ok(b.status === "sent" && b.sentToday === 2);
    await age(24 * 3600 + 1);
    const c = await req({ sub: "Uy" });
    assert.ok(c.status === "sent" && c.sentToday === 1, JSON.stringify(c));
  });

  test("concurrent sends cannot exceed the per-number limit", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => req({ sub: `Uc${i}`, ip: `192.0.2.${i}` })));
    assert.equal(results.filter((r) => r.status === "sent").length, 3);
  });

  test("correct code signs in once (single use)", async () => {
    const code = await issue();
    assert.deepEqual(await verify({ code }), { ok: true });
    assert.deepEqual(await verify({ code }), { ok: false, reason: "expired" });
  });

  test("code is bound to the LINE sub that requested it", async () => {
    const code = await issue();
    assert.deepEqual(await verify({ sub: "Uattacker", code }), { ok: false, reason: "expired" });
    assert.deepEqual(await verify({ code }), { ok: true });
  });

  test("5 wrong guesses kill the code, even the right code afterwards", async () => {
    const code = await issue();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      assert.deepEqual(await verify({ code: wrong }), { ok: false, reason: "invalid", remaining: MAX_ATTEMPTS - i });
    }
    assert.deepEqual(await verify({ code: wrong }), { ok: false, reason: "locked" });
    assert.deepEqual(await verify({ code }), { ok: false, reason: "locked" });
    const { rows } = await pool.query("SELECT attempts, used_at FROM otp_codes");
    assert.equal(rows[0].attempts, MAX_ATTEMPTS);
    assert.equal(rows[0].used_at, null);
  });

  test("a malformed code counts as an attempt and never reaches the transport", async () => {
    await issue();
    assert.deepEqual(await verify({ code: "12345" }), { ok: false, reason: "invalid", remaining: 4 });
    assert.equal(fake.state.checks, 0);
  });

  test("provider verdicts: wrong counts an attempt; used/expired ends the code; an outage gives the attempt back", async () => {
    const code = await issue();
    fake.state.checkWith = () => ({ ok: false, reason: "wrong", providerCode: 203 });
    assert.deepEqual(await verify({ code }), { ok: false, reason: "invalid", remaining: 4 });
    fake.state.checkWith = () => ({ ok: false, reason: "failed", providerCode: null });
    assert.deepEqual(await verify({ code }), { ok: false, reason: "unavailable", detail: "failed", providerCode: null });
    fake.state.checkWith = () => ({ ok: false, reason: "misconfigured", providerCode: 9 });
    assert.deepEqual(await verify({ code }), { ok: false, reason: "unavailable", detail: "misconfigured", providerCode: 9 });
    assert.equal((await pool.query("SELECT attempts FROM otp_codes")).rows[0].attempts, 1, "outages cost no attempt");
    fake.state.checkWith = () => ({ ok: false, reason: "expired", providerCode: 201 });
    assert.deepEqual(await verify({ code }), { ok: false, reason: "expired" });
    fake.state.checkWith = null;
    assert.deepEqual(await verify({ code }), { ok: false, reason: "expired" }, "our row ended with the provider's");
  });

  test("concurrent guesses never exceed 5 attempts", async () => {
    const code = await issue();
    const wrong = code === "000000" ? "111111" : "000000";
    const results = await Promise.all(Array.from({ length: 25 }, () => verify({ code: wrong })));
    const { rows } = await pool.query("SELECT attempts FROM otp_codes");
    assert.equal(rows[0].attempts, MAX_ATTEMPTS);
    const counted = results.filter((r) => !r.ok && (r.reason === "invalid" || r.reason === "locked")).length;
    assert.equal(counted, 25);
    assert.equal(results.filter((r) => !r.ok && r.reason === "invalid").length, MAX_ATTEMPTS - 1);
  });

  test("concurrent correct submissions succeed exactly once", async () => {
    const code = await issue();
    const results = await Promise.all(Array.from({ length: 8 }, () => verify({ code })));
    assert.equal(results.filter((r) => r.ok).length, 1);
  });

  test("a new code invalidates older unused codes", async () => {
    const first = await issue();
    await age(61);
    const second = await issue();
    if (first !== second) {
      const v = await verify({ code: first });
      assert.equal(v.ok, false);
    }
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM otp_codes WHERE expires_at > now()");
    assert.equal(rows[0].n, 1);
    assert.deepEqual(await verify({ code: second }), { ok: true });
  });

  test("expired codes are rejected", async () => {
    const code = await issue();
    await pool.query("UPDATE otp_codes SET expires_at = now() - interval '1 second'");
    assert.deepEqual(await verify({ code }), { ok: false, reason: "expired" });
  });

  test("LINE bindings are fresh for 180 days", async () => {
    assert.equal(await findFreshBinding(pool, sub), null);
    await upsertBinding(pool, sub, phone, "หมอ");
    assert.equal((await findFreshBinding(pool, sub))?.phone, phone);
    await upsertBinding(pool, sub, "0611111111", "หมอ");
    assert.equal((await findFreshBinding(pool, sub))?.phone, "0611111111");
    await pool.query("UPDATE line_bindings SET verified_at = now() - interval '181 days'");
    assert.equal(await findFreshBinding(pool, sub), null);
  });

  test("login events are recorded", async () => {
    await logEvent(pool, { event: "login_otp", sub, phone, ip, userAgent: "ua" });
    const { rows } = await pool.query("SELECT event, line_sub, phone, ip, user_agent FROM login_events");
    assert.deepEqual(rows, [{ event: "login_otp", line_sub: sub, phone, ip, user_agent: "ua" }]);
  });
});
