import "./_setup";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { smsConfig, type SmsConfig } from "@/lib/env";
import { openToken, smsTransport } from "@/lib/sms";
import { alertsAfterSend, alertsAfterVerify, resetSmsAlerts } from "@/lib/sms/alerts";
import { checkVerification, startVerification, type TwilioConfig } from "@/lib/sms/twilio";
import { setTestEnv, TEST_PEPPER as PEPPER } from "./_setup";

// Invented values in the right shapes (never real credentials).
const ACCOUNT = `AC${"0".repeat(32)}`;
const TOKEN = "testtesttesttesttesttesttesttest";
const SERVICE = `VA${"0".repeat(31)}1`;
const SID = `VE${"0".repeat(31)}2`;
const CFG: TwilioConfig = { accountSid: ACCOUNT, authToken: TOKEN, serviceSid: SERVICE, apiUrl: "https://verify.test/v2" };

interface Call {
  url: string;
  init: RequestInit;
  form: Record<string, string>;
}

/** A fetch stand-in answering `reply` with `status` (an object becomes JSON; a string is sent as is). */
function fakeFetch(reply: unknown, status = 200) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, form: Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))) });
    const text = typeof reply === "string" ? reply : JSON.stringify(reply);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

/** A fetch stand-in that throws like Node's fetch does. */
function throwingFetch(make: () => Error): typeof fetch {
  return (async () => {
    throw make();
  }) as typeof fetch;
}

function captureLogs() {
  const lines: string[] = [];
  const orig = { error: console.error, warn: console.warn, info: console.info, log: console.log };
  for (const k of ["error", "warn", "info", "log"] as const) console[k] = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  return { lines, restore: () => Object.assign(console, orig) };
}

const twilioError = (code: number, status: number) => ({
  code,
  message: "Some message that may echo +66812345678",
  more_info: `https://www.twilio.com/docs/errors/${code}`,
  status,
});

describe("Twilio Verify: start a verification", () => {
  test("posts To in E.164, Channel=sms and Locale=th to the service, with Basic auth; returns the SID", async () => {
    const { f, calls } = fakeFetch({ sid: SID, service_sid: SERVICE, to: "+66812345678", channel: "sms", status: "pending" }, 201);
    assert.deepEqual(await startVerification(CFG, "0812345678", { fetch: f }), { ok: true, sid: SID });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://verify.test/v2/Services/${SERVICE}/Verifications`);
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(calls[0].form, { To: "+66812345678", Channel: "sms", Locale: "th" });
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.authorization, `Basic ${Buffer.from(`${ACCOUNT}:${TOKEN}`).toString("base64")}`);
    assert.equal(headers["content-type"], "application/x-www-form-urlencoded");
  });

  test("maps Twilio's refusals; a 4xx sent nothing, a 5xx or an unreadable answer may have", async () => {
    const logs = captureLogs();
    try {
      const cases: [unknown, number, string][] = [
        [twilioError(60200, 400), 400, "invalid_number"],
        [twilioError(60205, 400), 400, "invalid_number"],
        [twilioError(21211, 400), 400, "invalid_number"],
        [twilioError(21614, 400), 400, "invalid_number"],
        [twilioError(20003, 401), 401, "misconfigured"],
        [twilioError(20404, 404), 404, "misconfigured"],
        [twilioError(60605, 403), 403, "misconfigured"],
        [twilioError(60223, 400), 400, "misconfigured"],
        [twilioError(60410, 403), 403, "misconfigured"],
        [twilioError(21608, 400), 400, "misconfigured"],
        [{ message: "Forbidden" }, 403, "misconfigured"],
        [twilioError(20005, 401), 401, "no_credit"],
        [twilioError(60203, 429), 429, "failed"],
        [twilioError(20429, 429), 429, "failed"],
        [twilioError(60212, 429), 429, "failed"],
        [twilioError(12345, 400), 400, "failed"],
        [twilioError(20500, 500), 500, "uncertain"],
        ["<html>502 Bad Gateway</html>", 502, "uncertain"],
        [{ status: "pending" }, 201, "uncertain"],
        [{ sid: "VEnot-a-sid", status: "pending" }, 201, "uncertain"],
      ];
      for (const [reply, status, reason] of cases) {
        const { f } = fakeFetch(reply, status);
        const r = await startVerification(CFG, "0812345678", { fetch: f });
        assert.ok(!r.ok && r.reason === reason, `${status} ${JSON.stringify(reply)} -> ${JSON.stringify(r)}`);
      }
      const timeout = await startVerification(CFG, "0812345678", {
        fetch: throwingFetch(() => Object.assign(new Error("t"), { name: "TimeoutError" })),
      });
      assert.ok(!timeout.ok && timeout.reason === "uncertain", "a timeout may have sent the SMS");
      const dns = await startVerification(CFG, "0812345678", {
        fetch: throwingFetch(() => Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } })),
      });
      assert.ok(!dns.ok && dns.reason === "failed", "no DNS answer: certainly not sent");
      const reset = await startVerification(CFG, "0812345678", {
        fetch: throwingFetch(() => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })),
      });
      assert.ok(!reset.ok && reset.reason === "uncertain", "a dropped connection may have sent the SMS");
    } finally {
      logs.restore();
    }
    const all = logs.lines.join("\n");
    assert.match(all, /\[sms\] Twilio verification failed: HTTP 403, code 60605/);
    assert.match(all, /Twilio verification failed: timeout/);
    for (const secret of [TOKEN, "0812345678", "+66812345678", "66812345678", "may echo"]) {
      assert.ok(!all.includes(secret), `${secret} is never logged`);
    }
  });
});

describe("Twilio Verify: check a code", () => {
  test("posts VerificationSid and Code; approved is a match, pending a wrong code", async () => {
    const { f, calls } = fakeFetch({ sid: SID, status: "approved", valid: true });
    assert.deepEqual(await checkVerification(CFG, SID, "123456", { fetch: f }), { ok: true });
    assert.equal(calls[0].url, `https://verify.test/v2/Services/${SERVICE}/VerificationCheck`);
    assert.deepEqual(calls[0].form, { VerificationSid: SID, Code: "123456" });

    const logs = captureLogs();
    try {
      const cases: [unknown, number, string][] = [
        [{ sid: SID, status: "pending", valid: false }, 200, "wrong"],
        [{ sid: SID, status: "canceled" }, 200, "expired"],
        [{ sid: SID, status: "max_attempts_reached" }, 200, "expired"],
        [{ sid: SID, status: "expired" }, 200, "expired"],
        [twilioError(20404, 404), 404, "expired"],
        [twilioError(60202, 429), 429, "expired"],
        [twilioError(20003, 401), 401, "misconfigured"],
        [twilioError(20005, 401), 401, "misconfigured"],
        [twilioError(20429, 429), 429, "failed"],
        [twilioError(20500, 500), 500, "failed"],
        [{ sid: SID, status: "something new" }, 200, "failed"],
        ["not json", 502, "failed"],
      ];
      for (const [reply, status, reason] of cases) {
        const { f: f2 } = fakeFetch(reply, status);
        const r = await checkVerification(CFG, SID, "123456", { fetch: f2 });
        assert.ok(!r.ok && r.reason === reason, `${status} ${JSON.stringify(reply)} -> ${JSON.stringify(r)}`);
      }
      const t = await checkVerification(CFG, SID, "123456", {
        fetch: throwingFetch(() => Object.assign(new Error("t"), { name: "TimeoutError" })),
      });
      assert.ok(!t.ok && t.reason === "failed");
      const { f: never, calls: none } = fakeFetch({ status: "approved" });
      const bad = await checkVerification(CFG, "VE-not-a-sid", "123456", { fetch: never });
      assert.ok(!bad.ok && bad.reason === "expired");
      assert.equal(none.length, 0, "a malformed SID is never sent");
    } finally {
      logs.restore();
    }
    const all = logs.lines.join("\n");
    for (const secret of [TOKEN, SID, "123456"]) assert.ok(!all.includes(secret), `${secret} is never logged`);
    assert.ok(!/pending/.test(all), "a wrong code is not logged as a failure");
  });
});

describe("Twilio transport", () => {
  const cfg: SmsConfig = {
    kind: "twilio",
    apiKey: "",
    secretKey: "",
    sender: "deeSMS.OTP",
    apiUrl: "",
    twilio: CFG,
    outboxDir: "",
    dailyCap: 300,
  };

  test("stores only the sealed verification SID, shows no reference, and checks the code with Twilio", async () => {
    const { f } = fakeFetch({ sid: SID, status: "pending" }, 201);
    const issued = await smsTransport(cfg, { fetch: f }).issue({ phone: "0812345678", sub: "U1", pepper: PEPPER });
    assert.ok(issued.ok);
    assert.equal(issued.ref, "");
    assert.equal(issued.creditBalance, null);
    assert.equal(issued.stored.codeHash, null);
    assert.ok(!issued.stored.providerToken!.includes(SID), "sealed");
    assert.equal(openToken(PEPPER, issued.stored.providerToken!), SID);

    const { f: v, calls } = fakeFetch({ sid: SID, status: "approved" });
    const ok = await smsTransport(cfg, { fetch: v }).check({ phone: "0812345678", sub: "U1", pepper: PEPPER, code: "123456", stored: issued.stored });
    assert.deepEqual(ok, { ok: true });
    assert.equal(calls[0].form.VerificationSid, SID);

    const { f: never, calls: none } = fakeFetch({ status: "approved" });
    const other = await smsTransport(cfg, { fetch: never }).check({
      phone: "0812345678",
      sub: "U1",
      pepper: `${PEPPER}x`,
      code: "123456",
      stored: issued.stored,
    });
    assert.ok(!other.ok && other.reason === "expired", "another pepper cannot open the SID");
    assert.equal(none.length, 0);
  });

  test("a refusal keeps Twilio's code for the alerts", async () => {
    const logs = captureLogs();
    try {
      const { f } = fakeFetch(twilioError(60605, 403), 403);
      const r = await smsTransport(cfg, { fetch: f }).issue({ phone: "0812345678", sub: "U1", pepper: PEPPER });
      assert.deepEqual(r, { ok: false, reason: "misconfigured", providerCode: 60605 });
    } finally {
      logs.restore();
    }
  });
});

describe("Twilio configuration", () => {
  afterEach(() => setTestEnv());
  const twilioEnv = () => {
    process.env.TWILIO_ACCOUNT_SID = ACCOUNT;
    process.env.TWILIO_AUTH_TOKEN = TOKEN;
    process.env.TWILIO_VERIFY_SERVICE_SID = SERVICE;
  };

  test("Twilio is chosen when its Verify Service SID is set, unless SMS_PROVIDER says otherwise", () => {
    delete process.env.SMS_PROVIDER;
    twilioEnv();
    const c = smsConfig();
    assert.equal(c.kind, "twilio");
    assert.deepEqual(c.twilio, { accountSid: ACCOUNT, authToken: TOKEN, serviceSid: SERVICE, apiUrl: "https://verify.twilio.com/v2" });
    process.env.SMS_PROVIDER = "console";
    assert.equal(smsConfig().kind, "console");
    assert.equal(smsConfig().twilio, null);
    process.env.SMS_PROVIDER = "deesmsx";
    process.env.DEESMSX_API_KEY = "k";
    process.env.DEESMSX_SECRET_KEY = "s";
    assert.equal(smsConfig().kind, "deesmsx");
    delete process.env.SMS_PROVIDER;
    delete process.env.TWILIO_VERIFY_SERVICE_SID;
    assert.equal(smsConfig().kind, "deesmsx", "without Twilio settings: deeSMSX as before");
  });

  test("on Vercel: SMS_PROVIDER=twilio|deesmsx is honoured, the local modes and the mock URL are not", () => {
    twilioEnv();
    process.env.TWILIO_VERIFY_API_URL = "http://127.0.0.1:4012/v2/";
    process.env.SMS_PROVIDER = "twilio";
    assert.equal(smsConfig().twilio?.apiUrl, "http://127.0.0.1:4012/v2", "the mock URL works locally");
    process.env.VERCEL = "1";
    process.env.SMS_PROVIDER = "file";
    const v = smsConfig();
    assert.equal(v.kind, "twilio", "SMS_PROVIDER=file is ignored on Vercel");
    assert.equal(v.twilio?.apiUrl, "https://verify.twilio.com/v2", "TWILIO_VERIFY_API_URL is ignored on Vercel");
    process.env.SMS_PROVIDER = "deesmsx";
    process.env.DEESMSX_API_KEY = "k";
    process.env.DEESMSX_SECRET_KEY = "s";
    assert.equal(smsConfig().kind, "deesmsx");
  });

  test("missing or malformed Twilio values are reported by name", () => {
    for (const [name, value] of [
      ["TWILIO_ACCOUNT_SID", ""],
      ["TWILIO_ACCOUNT_SID", "VA" + "0".repeat(32)],
      ["TWILIO_AUTH_TOKEN", ""],
      ["TWILIO_AUTH_TOKEN", "has spaces in it, has spaces in it"],
      ["TWILIO_VERIFY_SERVICE_SID", `AC${"0".repeat(32)}`],
      ["TWILIO_VERIFY_SERVICE_SID", "VA123"],
      ["TWILIO_VERIFY_API_URL", "ftp://x"],
    ]) {
      setTestEnv();
      process.env.SMS_PROVIDER = "twilio";
      twilioEnv();
      process.env[name] = value;
      assert.throws(() => smsConfig(), (e: unknown) => (e as { names?: string[] }).names?.includes(name) === true, `${name}=${value}`);
    }
  });
});

describe("Twilio alerts", () => {
  beforeEach(() => resetSmsAlerts());
  afterEach(() => resetSmsAlerts());
  const t0 = Date.UTC(2026, 10, 3, 9, 0);
  const failed = (reason: "misconfigured" | "no_credit" | "uncertain", providerCode: number | null) =>
    ({ status: "failed" as const, reason, providerCode });

  test("a refused setting names Twilio and what to fix, never deeSMSX", () => {
    const geo = alertsAfterSend(failed("misconfigured", 60605), 300, t0, "twilio");
    assert.equal(geo.length, 1);
    assert.match(geo[0], /^🛠 <b>ตั้งค่า SMS ไม่ถูกต้อง ส่งรหัสไม่ได้<\/b>/);
    assert.match(geo[0], /Twilio ปฏิเสธคำขอ \(รหัส 60605\)/);
    assert.match(geo[0], /Geo permissions/);
    assert.ok(!/deeSMSX|DEESMSX/i.test(geo[0]));
    assert.ok(!/[<>&]/.test(geo[0].replace(/<\/?b>/g, "")), "no bare < > & for Telegram HTML");
    resetSmsAlerts();
    const auth = alertsAfterVerify({ ok: false, reason: "unavailable", detail: "misconfigured", providerCode: 20003 }, t0, "twilio");
    assert.match(auth[0], /TWILIO_AUTH_TOKEN/);
    resetSmsAlerts();
    const trial = alertsAfterSend(failed("misconfigured", 21608), 300, t0, "twilio");
    assert.match(trial[0], /trial/);
    resetSmsAlerts();
    const unknown = alertsAfterSend(failed("misconfigured", null), 300, t0, "twilio");
    assert.match(unknown[0], /TWILIO_VERIFY_SERVICE_SID/);
    assert.ok(!unknown[0].includes("(รหัส"));
  });

  test("a suspended account and repeated uncertain sends have Twilio texts", () => {
    const n = alertsAfterSend(failed("no_credit", 20005), 300, t0, "twilio");
    assert.match(n[0], /บัญชี Twilio ใช้งานไม่ได้/);
    assert.match(n[0], /เติมเงินที่ console\.twilio\.com/);
    for (const m of [0, 1]) assert.deepEqual(alertsAfterSend(failed("uncertain", null), 300, t0 + m * 60_000, "twilio"), []);
    const u = alertsAfterSend(failed("uncertain", null), 300, t0 + 2 * 60_000, "twilio");
    assert.equal(u.length, 1);
    assert.match(u[0], /Twilio ไม่ตอบหรือตอบผิดรูปแบบ 3 ครั้งใน 15 นาที/);
  });
});
