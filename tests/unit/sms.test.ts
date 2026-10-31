import "./_setup";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { smsConfig, type SmsConfig } from "@/lib/env";
import { codeMatches } from "@/lib/otp";
import { openToken, sealToken, smsTransport } from "@/lib/sms";
import {
  alertDue,
  alertsAfterSend,
  alertsAfterVerify,
  LOW_CREDIT_BELOW,
  resetSmsAlerts,
  UNCERTAIN_ALERT_AFTER,
  volumeThreshold,
} from "@/lib/sms/alerts";
import { cleanRef, creditBalance, referenceCode, requestOtp, verifyOtp, type DeesmsxConfig } from "@/lib/sms/deesmsx";
import { generateRef, otpText } from "@/lib/sms/local";
import { setTestEnv, TEST_PEPPER as PEPPER } from "./_setup";

const CFG: DeesmsxConfig = {
  apiKey: "test-api-key-123",
  secretKey: "test-secret-key-456",
  sender: "deeSMS.OTP",
  apiUrl: "https://sms.test/v1",
};
const TOKEN = "62a287064ce31bb74868126b92d8ebf331148ca531e4787cc697352e571813213";

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, string>;
}

/** A fetch stand-in answering `reply` (an object becomes JSON; a string is sent as is). */
function fakeFetch(reply: unknown, status = 200) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body ?? "{}")) });
    const text = typeof reply === "string" ? reply : JSON.stringify(reply);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

/** Captures console output so tests can check nothing secret is logged. */
function captureLogs() {
  const lines: string[] = [];
  const orig = { error: console.error, warn: console.warn, info: console.info, log: console.log };
  for (const k of ["error", "warn", "info", "log"] as const) console[k] = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  return {
    lines,
    restore: () => Object.assign(console, orig),
  };
}

const OK_REQUEST = {
  error: "0",
  msg: "[ACCEPTD] Message is in accepted state",
  status: "200",
  credit_balance: 10,
  result: { requestNo: "OTP_21-Jan-2022_15:11:02.729619", token: TOKEN, ref: "9N14" },
};

describe("deeSMSX OTP request", () => {
  test("posts the documented fields as JSON, with the number in 66 format, and reads token, ref and credit", async () => {
    const { f, calls } = fakeFetch(OK_REQUEST);
    const r = await requestOtp(CFG, "0812345678", { fetch: f });
    assert.deepEqual(r, { ok: true, token: TOKEN, ref: "9N14", creditBalance: 10 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://sms.test/v1/otp/request");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.cache, "no-store");
    assert.ok(calls[0].init.signal instanceof AbortSignal, "has a timeout signal");
    assert.equal((calls[0].init.headers as Record<string, string>)["content-type"], "application/json");
    assert.deepEqual(calls[0].body, {
      apiKey: "test-api-key-123",
      secretKey: "test-secret-key-456",
      sender: "deeSMS.OTP",
      to: "66812345678",
      lang: "th",
      isShowRef: "1",
    });
  });

  test("codes and balances may come as numbers or strings", async () => {
    const { f } = fakeFetch({ ...OK_REQUEST, error: 0, credit_balance: "42.5" });
    assert.deepEqual(await requestOtp(CFG, "0900000001", { fetch: f }), { ok: true, token: TOKEN, ref: "9N14", creditBalance: 42.5 });
    assert.equal(referenceCode({ code: "9" }), 9);
    assert.equal(referenceCode({ code: 102 }), 102);
    assert.equal(referenceCode({ error: "203", code: "x" }), 203);
    assert.equal(referenceCode({ error: "Something", code: "9" }), 9, "a non-numeric error falls back to code");
    assert.equal(referenceCode({ msg: "nothing" }), null);
    assert.equal(creditBalance({ credit_balance: "abc" }), null);
    assert.equal(creditBalance({}), null);
    const { f: f2 } = fakeFetch({ ...OK_REQUEST, credit_balance: undefined });
    const r = await requestOtp(CFG, "0900000001", { fetch: f2 });
    assert.ok(r.ok && r.creditBalance === null);
  });

  test("maps every reference code (errors as `code`, as in the docs' example, or as `error`)", async () => {
    const logs = captureLogs();
    try {
      const cases: [unknown, string][] = [
        [{ code: "99", status: "500", msg: "Invalid telephone format." }, "invalid_number"],
        [{ code: "9", status: "500", msg: "Api Key or Secret Key Incorrect" }, "misconfigured"],
        [{ error: "100", status: "163", msg: "Sender Name Not Found !" }, "misconfigured"],
        [{ code: 204, status: "500", msg: "Not Found Template" }, "misconfigured"],
        [{ code: "102", status: "166", msg: "Your account exceed credit limit." }, "no_credit"],
        // deeSMSX does not say whether these sent the SMS: "uncertain" (the reservation is kept, see lib/otp.ts)
        [{ code: "101", status: "166", msg: "Unable to proceed, please contact Administrator." }, "uncertain"],
        [{ code: "777", msg: "unknown" }, "uncertain"],
        [{ msg: "no code at all" }, "uncertain"],
      ];
      for (const [reply, reason] of cases) {
        const { f } = fakeFetch(reply, 500);
        const r = await requestOtp(CFG, "0812345678", { fetch: f });
        assert.equal(r.ok, false, JSON.stringify(reply));
        assert.ok(!r.ok && r.reason === reason, `${JSON.stringify(reply)} -> ${JSON.stringify(r)}`);
      }
    } finally {
      logs.restore();
    }
    const all = logs.lines.join("\n");
    assert.match(all, /deeSMSX OTP request failed: code 9\b/);
    assert.ok(!all.includes(CFG.apiKey) && !all.includes(CFG.secretKey), "keys never logged");
    assert.ok(!all.includes("Api Key or Secret Key Incorrect"), "only the code is logged, not the provider's message");
  });

  test("success without a usable token is uncertain (the SMS went out, the code cannot be checked)", async () => {
    const logs = captureLogs();
    try {
      for (const result of [{}, { token: "", ref: "AB12" }, { token: 12345, ref: "AB12" }, { token: "x".repeat(2049), ref: "AB12" }, null]) {
        const { f } = fakeFetch({ ...OK_REQUEST, result });
        const r = await requestOtp(CFG, "0812345678", { fetch: f });
        assert.ok(!r.ok && r.reason === "uncertain", JSON.stringify(result));
      }
    } finally {
      logs.restore();
    }
  });

  test("an unexpected ref never fails a delivered code: it is cleaned, or left out", async () => {
    const cases: [unknown, string][] = [
      ["9N-14", "9N-14"],
      ["  AB 12 ", "AB 12"],
      ["<b>", "<b>"],
      ["REF-ABCDEFGHIJKLMNOPQRSTUVWXYZ", "REF-ABCDEFGHIJKL"],
      ["รหัส AB12", "AB12"],
      ["AB\n12", "AB 12"],
      [1234, "1234"],
      [undefined, ""],
      [null, ""],
      ["ไทย", ""],
    ];
    for (const [ref, shown] of cases) {
      const { f } = fakeFetch({ ...OK_REQUEST, result: { token: TOKEN, ref } });
      const r = await requestOtp(CFG, "0812345678", { fetch: f });
      assert.deepEqual(r, { ok: true, token: TOKEN, ref: shown, creditBalance: 10 }, JSON.stringify(ref));
      assert.equal(cleanRef(ref), shown);
    }
  });

  test("malformed JSON, an HTML error page, a dropped connection and a timeout are uncertain", async () => {
    const logs = captureLogs();
    try {
      for (const body of ['{"error": "0", "credit_balance": 10 "result": {}}', "<html>502 Bad Gateway</html>", "[1,2]", ""]) {
        const { f } = fakeFetch(body, 502);
        const r = await requestOtp(CFG, "0812345678", { fetch: f });
        assert.ok(!r.ok && r.reason === "uncertain", body);
      }
      const network = (async () => {
        throw new TypeError("fetch failed: socket hang up apikey=test-api-key-123");
      }) as typeof fetch;
      const r1 = await requestOtp(CFG, "0812345678", { fetch: network });
      assert.ok(!r1.ok && r1.reason === "uncertain", "an error without a known cause may have come after sending");
      const reset = (async () => {
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
      }) as typeof fetch;
      const r1b = await requestOtp(CFG, "0812345678", { fetch: reset });
      assert.ok(!r1b.ok && r1b.reason === "uncertain");
      // Errors raised before the request could leave: certainly not sent.
      for (const code of ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]) {
        const before = (async () => {
          throw new TypeError("fetch failed", { cause: Object.assign(new Error(`getaddrinfo ${code} apikey=test-api-key-123`), { code }) });
        }) as typeof fetch;
        const r = await requestOtp(CFG, "0812345678", { fetch: before });
        assert.ok(!r.ok && r.reason === "failed", code);
      }
      // a server that never answers: the call gives up at the timeout
      const hang = ((_u: unknown, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })) as typeof fetch;
      const started = Date.now();
      // AbortSignal.timeout's timer does not keep the process alive; this one does, until the call gives up.
      const keepAlive = setTimeout(() => {}, 5000);
      const r2 = await requestOtp(CFG, "0812345678", { fetch: hang, timeoutMs: 50 });
      clearTimeout(keepAlive);
      assert.ok(!r2.ok && r2.reason === "uncertain");
      assert.ok(Date.now() - started < 2000, "gave up quickly");
    } finally {
      logs.restore();
    }
    const all = logs.lines.join("\n");
    assert.match(all, /OTP request failed: timeout/);
    assert.match(all, /OTP request failed: network \(TypeError\)/);
    assert.match(all, /OTP request failed: network \(TypeError ENOTFOUND\)/);
    assert.ok(!all.includes("test-api-key-123"), "error messages (which may echo the request) are not logged");
  });
});

describe("deeSMSX OTP verify", () => {
  test("posts apiKey, secretKey, token and pin; maps success and each verify code", async () => {
    const { f, calls } = fakeFetch({ status: "0", error: "0", msg: "Verify Success", result: {} });
    assert.deepEqual(await verifyOtp(CFG, TOKEN, "123456", { fetch: f }), { ok: true });
    assert.equal(calls[0].url, "https://sms.test/v1/otp/verify");
    assert.deepEqual(calls[0].body, { apiKey: CFG.apiKey, secretKey: CFG.secretKey, token: TOKEN, pin: "123456" });

    const logs = captureLogs();
    try {
      const cases: [unknown, string][] = [
        [{ status: "500", error: "201", msg: "Token Expires", result: {} }, "expired"],
        [{ status: "163", error: "202", msg: "Token Is Activated" }, "expired"],
        [{ status: "163", error: 203, msg: "Token or Pin Incorrect" }, "wrong"],
        [{ code: "9", msg: "Api Key or Secret Key Incorrect" }, "misconfigured"],
        [{ error: "204" }, "misconfigured"],
        [{ error: "101" }, "failed"],
        ["not json", "failed"],
      ];
      for (const [reply, reason] of cases) {
        const { f: f2 } = fakeFetch(reply);
        const r = await verifyOtp(CFG, TOKEN, "123456", { fetch: f2 });
        assert.ok(!r.ok && r.reason === reason, `${JSON.stringify(reply)} -> ${JSON.stringify(r)}`);
      }
    } finally {
      logs.restore();
    }
    const all = logs.lines.join("\n");
    assert.ok(!all.includes(TOKEN) && !all.includes("123456"), "token and pin never logged");
    assert.ok(!all.includes("code 203"), "a wrong code is not logged as a failure");
  });
});

describe("provider token sealing", () => {
  test("the stored token is encrypted, opens with the same pepper only, and detects tampering", () => {
    const sealed = sealToken(PEPPER, TOKEN);
    assert.ok(sealed.startsWith("v1.") && !sealed.includes(TOKEN));
    assert.notEqual(sealed, sealToken(PEPPER, TOKEN), "random IV");
    assert.equal(openToken(PEPPER, sealed), TOKEN);
    assert.equal(openToken(`${PEPPER}x`, sealed), null);
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1);
    assert.equal(openToken(PEPPER, flipped), null);
    assert.equal(openToken(PEPPER, "v1.short"), null);
    assert.equal(openToken(PEPPER, TOKEN), null);
  });
});

describe("transport (one interface for provider and local modes)", () => {
  const deesmsx: SmsConfig = { kind: "deesmsx", ...CFG, outboxDir: "", dailyCap: 300 };

  test("provider mode stores only the sealed token and checks the pin with the provider", async () => {
    const { f, calls } = fakeFetch(OK_REQUEST);
    const t = smsTransport(deesmsx, { fetch: f });
    const issued = await t.issue({ phone: "0812345678", sub: "U1", pepper: PEPPER });
    assert.ok(issued.ok);
    assert.equal(issued.ref, "9N14");
    assert.equal(issued.stored.codeHash, null);
    assert.equal(openToken(PEPPER, issued.stored.providerToken!), TOKEN);
    const { f: v } = fakeFetch({ status: "0", error: "0", msg: "Verify Success" });
    const t2 = smsTransport(deesmsx, { fetch: v });
    assert.deepEqual(await t2.check({ phone: "0812345678", sub: "U1", pepper: PEPPER, code: "123456", stored: issued.stored }), { ok: true });
    // a token that cannot be opened (other pepper, local row): ask for a new code, never call the provider
    const { f: never, calls: none } = fakeFetch({ error: "0" });
    const t3 = smsTransport(deesmsx, { fetch: never });
    const r = await t3.check({ phone: "0812345678", sub: "U1", pepper: `${PEPPER}x`, code: "123456", stored: issued.stored });
    assert.ok(!r.ok && r.reason === "expired");
    assert.equal(none.length, 0);
    assert.equal(calls.length, 1);
  });

  test("local file mode writes {to, text, code, ref, at}; only an HMAC is kept", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orskh-sms-"));
    const t = smsTransport({ kind: "file", apiKey: "", secretKey: "", sender: "x", apiUrl: "", outboxDir: dir, dailyCap: 300 });
    const issued = await t.issue({ phone: "0900000001", sub: "U1", pepper: PEPPER });
    assert.ok(issued.ok);
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    const sms = JSON.parse(readFileSync(join(dir, files[0]), "utf8"));
    assert.deepEqual(Object.keys(sms).sort(), ["at", "code", "ref", "text", "to"]);
    assert.equal(sms.to, "0900000001");
    assert.match(sms.code, /^\d{6}$/);
    assert.equal(sms.ref, issued.ref);
    assert.match(sms.ref, /^[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(sms.text, `รหัส ORSKH ของคุณคือ ${sms.code} ใช้ได้ 5 นาที ห้ามบอกผู้อื่น`);
    assert.equal(issued.stored.providerToken, null);
    assert.ok(codeMatches(PEPPER, "0900000001", "U1", sms.code, issued.stored.codeHash!));
    const ok = await t.check({ phone: "0900000001", sub: "U1", pepper: PEPPER, code: sms.code, stored: issued.stored });
    assert.deepEqual(ok, { ok: true });
    const wrong = await t.check({ phone: "0900000001", sub: "U2", pepper: PEPPER, code: sms.code, stored: issued.stored });
    assert.ok(!wrong.ok && wrong.reason === "wrong", "bound to the LINE account");
  });

  test("a failing local delivery is a failure, not an exception", async () => {
    const logs = captureLogs();
    try {
      // the outbox "folder" sits below a file, so it cannot be created
      const file = join(mkdtempSync(join(tmpdir(), "orskh-sms-")), "not-a-folder");
      writeFileSync(file, "x");
      const t = smsTransport({ kind: "file", apiKey: "", secretKey: "", sender: "x", apiUrl: "", outboxDir: join(file, "outbox"), dailyCap: 300 });
      const r = await t.issue({ phone: "0900000001", sub: "U1", pepper: PEPPER });
      assert.ok(!r.ok && r.reason === "failed");
    } finally {
      logs.restore();
    }
  });

  test("the SMS text has no link, fits one Thai SMS, and refs avoid look-alike characters", () => {
    const text = otpText("123456");
    assert.ok(Array.from(text).length < 70, `${Array.from(text).length} characters`);
    assert.ok(!/https?:|www\.|\.com|\.app|\//i.test(text), "no link or domain");
    assert.ok(!text.includes("\n"), "one line");
    for (let i = 0; i < 200; i++) assert.match(generateRef(), /^[A-HJ-NP-Z2-9]{4}$/);
  });
});

describe("SMS configuration", () => {
  afterEach(() => setTestEnv());

  test("defaults: deeSMSX at its real URL, the shared OTP sender, a cap of 300", () => {
    process.env.SMS_PROVIDER = "deesmsx";
    process.env.DEESMSX_API_KEY = "k";
    process.env.DEESMSX_SECRET_KEY = "s";
    delete process.env.DEESMSX_SENDER;
    delete process.env.DEESMSX_API_URL;
    delete process.env.SMS_DAILY_CAP;
    const c = smsConfig();
    assert.equal(c.kind, "deesmsx");
    assert.equal(c.apiUrl, "https://apicall.deesmsx.com/v1");
    assert.equal(c.sender, "deeSMS.OTP");
    assert.equal(c.dailyCap, 300);
  });

  test("the mock URL override and the local modes work locally but are ignored or refused on Vercel", () => {
    process.env.SMS_PROVIDER = "file";
    process.env.SMS_OUTBOX_DIR = "/tmp/outbox";
    assert.equal(smsConfig().kind, "file");
    process.env.DEESMSX_API_URL = "http://127.0.0.1:4011/v1/";
    process.env.SMS_PROVIDER = "deesmsx";
    process.env.DEESMSX_API_KEY = "k";
    process.env.DEESMSX_SECRET_KEY = "s";
    assert.equal(smsConfig().apiUrl, "http://127.0.0.1:4011/v1");
    process.env.VERCEL = "1";
    process.env.SMS_PROVIDER = "file";
    const v = smsConfig();
    assert.equal(v.kind, "deesmsx", "SMS_PROVIDER=file is ignored on Vercel");
    assert.equal(v.apiUrl, "https://apicall.deesmsx.com/v1", "DEESMSX_API_URL is ignored on Vercel");
    delete process.env.DEESMSX_API_KEY;
    assert.throws(() => smsConfig(), (e: unknown) => (e as { names?: string[] }).names?.includes("DEESMSX_API_KEY") === true);
  });

  test("invalid values are reported by name", () => {
    for (const [name, value] of [
      ["SMS_PROVIDER", "smtp"],
      ["SMS_DAILY_CAP", "0"],
      ["SMS_DAILY_CAP", "lots"],
      ["DEESMSX_SENDER", "has space"],
      ["DEESMSX_API_URL", "ftp://x"],
    ]) {
      setTestEnv();
      process.env.SMS_PROVIDER = "console";
      process.env[name] = value;
      assert.throws(() => smsConfig(), (e: unknown) => (e as { names?: string[] }).names?.includes(name) === true, `${name}=${value}`);
    }
  });
});

describe("SMS alerts", () => {
  beforeEach(() => resetSmsAlerts());
  afterEach(() => resetSmsAlerts());
  const t0 = Date.UTC(2026, 9, 29, 9, 0);
  const hour = 3600_000;

  test("low credit: below 100 alerts at most every 6 hours per instance", () => {
    const sent = (creditBalance: number | null, sentToday = 1) => ({ status: "sent" as const, ref: "AB12", sentToday, creditBalance });
    assert.deepEqual(alertsAfterSend(sent(LOW_CREDIT_BELOW), 300, t0), []);
    assert.deepEqual(alertsAfterSend(sent(null), 300, t0), []);
    const a = alertsAfterSend(sent(99), 300, t0);
    assert.equal(a.length, 1);
    assert.match(a[0], /^💳 <b>เครดิต SMS ใกล้หมด<\/b>\n/);
    assert.match(a[0], /เหลือ 99 เครดิต/);
    assert.deepEqual(alertsAfterSend(sent(50), 300, t0 + 5 * hour), [], "not again within 6 h");
    assert.equal(alertsAfterSend(sent(50), 300, t0 + 6 * hour).length, 1);
  });

  test("misconfiguration and no credit alert at most once an hour; the code is named, never a key", () => {
    const failed = (reason: "misconfigured" | "no_credit" | "invalid_number" | "failed" | "uncertain", providerCode: number | null) =>
      ({ status: "failed" as const, reason, providerCode });
    const m = alertsAfterSend(failed("misconfigured", 9), 300, t0);
    assert.equal(m.length, 1);
    assert.match(m[0], /^🛠 <b>ตั้งค่า SMS ไม่ถูกต้อง ส่งรหัสไม่ได้<\/b>/);
    assert.match(m[0], /\(รหัส 9\)/);
    assert.deepEqual(alertsAfterSend(failed("misconfigured", 204), 300, t0 + 30 * 60_000), []);
    assert.equal(alertsAfterVerify({ ok: false, reason: "unavailable", detail: "misconfigured", providerCode: 9 }, t0 + hour).length, 1);
    const n = alertsAfterSend(failed("no_credit", 102), 300, t0);
    assert.equal(n.length, 1);
    assert.match(n[0], /เครดิต SMS หมด/);
    assert.deepEqual(alertsAfterSend(failed("invalid_number", 99), 300, t0), [], "a wrong number is the user's problem");
    assert.deepEqual(alertsAfterSend(failed("failed", null), 300, t0), []);
    assert.deepEqual(alertsAfterSend(failed("uncertain", null), 300, t0), [], "one uncertain send is no alert");
    assert.deepEqual(alertsAfterVerify({ ok: false, reason: "unavailable", detail: "failed", providerCode: null }, t0 + 2 * hour), []);
  });

  test("the daily cap alerts when reached; half the cap gives a volume alert", () => {
    assert.equal(volumeThreshold(300), 150);
    assert.equal(volumeThreshold(1), 1);
    const capped = alertsAfterSend({ status: "capped", sentToday: 300, retryAfterS: 600 }, 300, t0);
    assert.equal(capped.length, 1);
    assert.match(capped[0], /^🛑 <b>ส่ง SMS ครบเพดานของวันแล้ว หยุดส่งรหัส<\/b>/);
    assert.match(capped[0], /ส่งครบ 300 ครั้ง/);
    assert.deepEqual(alertsAfterSend({ status: "capped", sentToday: 300, retryAfterS: 600 }, 300, t0 + 10 * 60_000), []);
    assert.deepEqual(alertsAfterSend({ status: "sent", ref: "AB12", sentToday: 149, creditBalance: null }, 300, t0), []);
    const v = alertsAfterSend({ status: "sent", ref: "AB12", sentToday: 150, creditBalance: null }, 300, t0);
    assert.equal(v.length, 1);
    assert.match(v[0], /มีการขอรหัสทาง SMS มากผิดปกติ/);
    assert.match(v[0], /\(เพดาน 300 ครั้ง\)/);
    // volume: at most every 6 hours; cap: at most every hour
    const sent160 = { status: "sent" as const, ref: "AB12", sentToday: 160, creditBalance: null };
    assert.deepEqual(alertsAfterSend(sent160, 300, t0 + 5 * hour), [], "volume not again within 6 h");
    assert.equal(alertsAfterSend(sent160, 300, t0 + 6 * hour).length, 1, "volume again after 6 h");
    assert.deepEqual(alertsAfterSend({ status: "capped", sentToday: 300, retryAfterS: 600 }, 300, t0 + hour - 1), []);
    assert.equal(alertsAfterSend({ status: "capped", sentToday: 300, retryAfterS: 600 }, 300, t0 + hour).length, 1, "cap again after 1 h");
  });

  test("repeated uncertain sends alert (3 within 15 minutes), at most once an hour", () => {
    const uncertain = { status: "failed" as const, reason: "uncertain" as const, providerCode: null };
    const min = 60_000;
    assert.equal(UNCERTAIN_ALERT_AFTER, 3);
    assert.deepEqual(alertsAfterSend(uncertain, 300, t0), []);
    assert.deepEqual(alertsAfterSend(uncertain, 300, t0 + 10 * min), []);
    assert.deepEqual(alertsAfterSend(uncertain, 300, t0 + 16 * min), [], "the first one left the 15-minute window");
    const a = alertsAfterSend({ ...uncertain, providerCode: 101 }, 300, t0 + 20 * min);
    assert.equal(a.length, 1);
    assert.match(a[0], /^⚠️ <b>ส่งรหัสทาง SMS ไม่สำเร็จซ้ำหลายครั้ง<\/b>/);
    assert.match(a[0], /\(รหัส 101\) 3 ครั้งใน 15 นาที/);
    assert.match(a[0], /อาจถูกส่งและตัดเครดิตไปแล้ว/);
    assert.deepEqual(alertsAfterSend(uncertain, 300, t0 + 30 * min), [], "not again within the hour");
    assert.deepEqual(alertsAfterSend({ status: "failed", reason: "failed", providerCode: null }, 300, t0 + 90 * min), []);
    for (const t of [81, 82]) assert.deepEqual(alertsAfterSend(uncertain, 300, t0 + t * min), []);
    assert.equal(alertsAfterSend(uncertain, 300, t0 + 83 * min).length, 1, "again after an hour");
  });

  test("alertDue is per kind", () => {
    assert.equal(alertDue("cap", t0), true);
    assert.equal(alertDue("cap", t0 + 1), false);
    assert.equal(alertDue("volume", t0 + 1), true);
  });
});
