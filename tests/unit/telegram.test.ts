import "./_setup";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import { ConfigError, telegramConfig, telegramEnabled } from "@/lib/env";
import { countOtpPhones, logEvent, otpHistory } from "@/lib/otp";
import { buildVerifiedAlert, buildVolumeAlert, escapeHtml, notify, notifyVerified, sendTelegram } from "@/lib/telegram";
import { setTestEnv, TEST_DB } from "./_setup";

const TOKEN = "123456789:AAtestTOKENtestTOKENtestTOKEN_x-y";
const AT = new Date("2026-10-25T08:47:00Z"); // 15:47 in Bangkok
const NONE = { phone: null, account: null };

function clearTelegram() {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_API_URL;
}

afterEach(() => {
  clearTelegram();
  setTestEnv();
});

describe("Telegram alert text", () => {
  test("first verification: new-user header, Thai date and time in Bangkok, total", () => {
    const html = buildVerifiedAlert({
      user: { id: "1", firstName: "สมชาย", lastName: "ใจดี", type: "DR", subtype: "GENSX" },
      lineName: "Pong",
      phone: "0812345678",
      at: AT,
      history: NONE,
      verifiedPhones: 12,
    });
    assert.equal(
      html,
      [
        "🆕 <b>ผู้ใช้ใหม่ยืนยันตัวตนสำเร็จ</b>",
        "ORSKH.APP ตารางห้องผ่าตัด",
        "",
        "🩺 แพทย์: สมชาย ใจดี (ศัลยกรรมทั่วไป)",
        "👤 ชื่อ LINE: Pong",
        "📱 เบอร์: 081-234-5678",
        "🕒 เวลา: 25 ต.ค. 2569 15:47 น.",
        "👥 ยืนยันแล้วทั้งหมด: 12 เบอร์",
      ].join("\n"),
    );
  });

  test("repeat verification: again header and the previous date", () => {
    const html = buildVerifiedAlert({
      user: { id: "2", firstName: "สมหญิง", lastName: "รักดี", type: "DR", subtype: null },
      lineName: "หมอ A",
      phone: "0900000001",
      at: AT,
      history: { phone: new Date("2026-04-12T03:00:00Z"), account: new Date("2026-04-12T03:00:00Z") },
      verifiedPhones: 1234,
    });
    assert.match(html, /^🔁 <b>ยืนยันตัวตนอีกครั้ง<\/b>\n/);
    assert.match(html, /\n🗓 เบอร์นี้ยืนยันครั้งก่อน: 12 เม\.ย\. 2569\n/);
    assert.match(html, /👥 ยืนยันแล้วทั้งหมด: 1,234 เบอร์$/);
    assert.doesNotMatch(html, /ผู้ใช้ใหม่/);
    assert.match(html, /\n🩺 แพทย์: สมหญิง รักดี\n/, "no brackets without a subtype");
    const nurse = buildVerifiedAlert({
      user: { id: "3", firstName: "ปราณี", lastName: "สายบุญ", type: "RN", subtype: "ANES" },
      lineName: "x",
      phone: "0900000001",
      at: AT,
      history: NONE,
      verifiedPhones: 1,
    });
    assert.match(nurse, /\n🩺 พยาบาล: ปราณี สายบุญ \(วิสัญญี\)\n/);
  });

  test("known number on a LINE account that never verified it: warning header", () => {
    const html = buildVerifiedAlert({
      user: { id: "1", firstName: "สมชาย", lastName: "ใจดี", type: "DR", subtype: "GENSX" },
      lineName: "someone",
      phone: "0900000002",
      at: AT,
      history: { phone: new Date("2026-10-20T03:00:00Z"), account: null },
      verifiedPhones: 3,
    });
    assert.match(html, /^⚠️ <b>บัญชี LINE ใหม่ของเบอร์ที่เคยยืนยันแล้ว<\/b>\n/);
    assert.match(html, /\n🗓 เบอร์นี้ยืนยันครั้งก่อน: 20 ต\.ค\. 2569\n/);
  });

  test("LINE name cannot inject markup or fake lines", () => {
    const html = buildVerifiedAlert({
      user: null,
      lineName: '<a href="https://evil.test">x</a>\n📱 เบอร์: 081-234-5678\u202E',
      phone: "0900000001",
      at: AT,
      history: NONE,
      verifiedPhones: 1,
    });
    const nameLine = html.split("\n").find((l) => l.startsWith("👤"));
    assert.ok(nameLine);
    assert.ok(!nameLine.includes("<a") && nameLine.includes("&lt;a href="), nameLine);
    assert.ok(!/\u202E/.test(html), "bidi override removed");
    assert.equal(html.split("\n").filter((l) => l.startsWith("📱")).length, 1, "only one number line");
    assert.match(html, /\n🩺 ไม่พบในรายชื่อเจ้าหน้าที่\n/);
    assert.equal(escapeHtml("a&b<c>"), "a&amp;b&lt;c&gt;");
  });

  test("approved (non-listed) user: the 🩺 line shows the requested name and position", () => {
    const html = buildVerifiedAlert({
      user: null,
      requester: { firstName: "สมชาย", lastName: "ใจดี", position: "RN" },
      lineName: "Som",
      phone: "0910000003",
      at: AT,
      history: NONE,
      verifiedPhones: 2,
    });
    assert.match(html, /\n🩺 พยาบาล: สมชาย ใจดี \(อนุมัติจากคำขอ\)\n/);
    const doctor = buildVerifiedAlert({
      user: null,
      requester: { firstName: "A", lastName: "B", position: "DR" },
      lineName: "x",
      phone: "0900000001",
      at: AT,
      history: NONE,
      verifiedPhones: 2,
    });
    assert.match(doctor, /\n🩺 แพทย์: A B \(อนุมัติจากคำขอ\)\n/);
    assert.doesNotMatch(doctor, /ไม่พบในรายชื่อ/);
  });

  test("the number and an approved requester's name are never shortened", () => {
    for (const phone of ["0812345678", "0611111111"]) {
      const html = buildVerifiedAlert({
        user: null,
        requester: { firstName: "ก".repeat(60), lastName: "ข".repeat(60), position: "DR" },
        lineName: "x",
        phone,
        at: AT,
        history: NONE,
        verifiedPhones: 1,
      });
      assert.ok(html.includes(`\n📱 เบอร์: ${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}\n`), html);
      assert.ok(html.includes(`\n🩺 แพทย์: ${"ก".repeat(60)} ${"ข".repeat(60)} (อนุมัติจากคำขอ)\n`), "whole name");
      assert.ok(!html.includes("…"));
    }
  });

  test("SMS volume alert", () => {
    assert.equal(
      buildVolumeAlert(1234, 2000, AT),
      [
        "⚠️ <b>มีการขอรหัสทาง SMS มากผิดปกติ</b>",
        "ORSKH.APP ตารางห้องผ่าตัด",
        "",
        "📨 ส่ง SMS ไปแล้ว 1,234 ครั้งใน 24 ชั่วโมงที่ผ่านมา (เพดาน 2,000 ครั้ง)",
        "เมื่อถึงเพดาน ระบบจะหยุดส่งรหัสให้ทุกคน ตรวจสอบตาราง otp_codes",
        "🕒 เวลา: 25 ต.ค. 2569 15:47 น.",
      ].join("\n"),
    );
  });

  test("empty or very long LINE names", () => {
    const empty = buildVerifiedAlert({ user: null, lineName: "  ", phone: "0900000001", at: AT, history: NONE, verifiedPhones: 1 });
    assert.match(empty, /👤 ชื่อ LINE: ไม่ระบุ/);
    const long = buildVerifiedAlert({ user: null, lineName: "ก".repeat(300), phone: "0900000001", at: AT, history: NONE, verifiedPhones: 1 });
    const line = long.split("\n").find((l) => l.startsWith("👤")) ?? "";
    assert.ok(line.length < 130 && line.endsWith("…"), line);
  });
});

describe("Telegram configuration", () => {
  test("off unless both settings are present", () => {
    assert.equal(telegramEnabled(), false);
    assert.equal(telegramConfig(), null);
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    assert.equal(telegramEnabled(), false);
    assert.equal(telegramConfig(), null);
    process.env.TELEGRAM_CHAT_ID = "  987654321 , -1001234567890 ";
    assert.equal(telegramEnabled(), true);
    const cfg = telegramConfig();
    assert.deepEqual(cfg?.chatIds, ["987654321", "-1001234567890"]);
    assert.equal(cfg?.apiUrl, "https://api.telegram.org");
  });

  test("malformed values are reported by name only", () => {
    process.env.TELEGRAM_BOT_TOKEN = "not-a-token";
    process.env.TELEGRAM_CHAT_ID = "me";
    try {
      telegramConfig();
      assert.fail("expected ConfigError");
    } catch (e) {
      assert.ok(e instanceof ConfigError);
      assert.deepEqual(e.names, ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]);
      assert.ok(!e.message.includes("not-a-token"));
    }
  });

  test("API override is ignored on Vercel", () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_CHAT_ID = "987654321";
    process.env.TELEGRAM_API_URL = "http://127.0.0.1:9";
    assert.equal(telegramConfig()?.apiUrl, "http://127.0.0.1:9");
    process.env.VERCEL = "1";
    assert.equal(telegramConfig()?.apiUrl, "https://api.telegram.org");
  });
});

describe("Telegram sending (mock Bot API)", () => {
  let server: Server;
  let base = "";
  let status = 200;
  const calls: { path: string; body: Record<string, unknown> }[] = [];

  before(async () => {
    server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        calls.push({ path: req.url ?? "", body: JSON.parse(data || "{}") });
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(status === 200 ? { ok: true, result: {} } : { ok: false, description: "Bad Request: chat not found" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  function configure() {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_CHAT_ID = "111,222";
    process.env.TELEGRAM_API_URL = base;
    calls.length = 0;
    status = 200;
  }

  test("sends HTML to every chat, without link previews", async () => {
    configure();
    assert.equal(await sendTelegram("<b>hi</b>"), true);
    assert.equal(calls.length, 2);
    for (const [i, c] of calls.entries()) {
      assert.equal(c.path, `/bot${TOKEN}/sendMessage`);
      assert.equal(c.body.chat_id, ["111", "222"][i]);
      assert.equal(c.body.text, "<b>hi</b>");
      assert.equal(c.body.parse_mode, "HTML");
      assert.deepEqual(c.body.link_preview_options, { is_disabled: true });
    }
  });

  test("SMS alerts go to every chat", async () => {
    configure();
    await notify(buildVolumeAlert(150, 300, AT));
    assert.equal(calls.length, 2);
    assert.ok(String(calls[0].body.text).startsWith("⚠️ <b>มีการขอรหัสทาง SMS มากผิดปกติ</b>"));
  });

  test("not configured: nothing is sent", async () => {
    calls.length = 0;
    assert.equal(await sendTelegram("x"), false);
    await notify(buildVolumeAlert(150, 300, AT));
    await notifyVerified({ user: null, lineName: "A", phone: "0900000001", at: AT, history: NONE, verifiedPhones: 1 });
    assert.equal(calls.length, 0);
  });

  test("API errors and bad settings are logged without the token and never thrown", async () => {
    configure();
    status = 400;
    await assert.rejects(sendTelegram("x"), (e: Error) => /HTTP 400: Bad Request: chat not found/.test(e.message) && !e.message.includes(TOKEN));

    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
    try {
      await notifyVerified({ user: null, lineName: "A", phone: "0900000001", at: AT, history: NONE, verifiedPhones: 1 });
      process.env.TELEGRAM_API_URL = "http://127.0.0.1:9"; // nothing listens there
      await notifyVerified({ user: null, lineName: "A", phone: "0900000001", at: AT, history: NONE, verifiedPhones: 1 });
      process.env.TELEGRAM_CHAT_ID = "not a chat";
      await notifyVerified({ user: null, lineName: "A", phone: "0900000001", at: AT, history: NONE, verifiedPhones: 1 });
    } finally {
      console.error = orig;
    }
    assert.equal(logged.length, 3, logged.join(" | "));
    assert.match(logged[0], /HTTP 400/);
    assert.match(logged[1], /telegram request failed/);
    assert.match(logged[2], /not configured: TELEGRAM_CHAT_ID/);
    for (const l of logged) assert.ok(!l.includes(TOKEN), l);
  });
});

describe("verification history (database)", () => {
  const pool = createPool(TEST_DB);

  before(async () => {
    await pool.query("DROP TABLE IF EXISTS otp_codes, line_bindings, login_events, user_claims, users, access_requests");
    await ensureSchema(pool);
  });
  after(() => pool.end());

  test("history per number and per LINE account, and distinct verified numbers, come from login_otp events only", async () => {
    assert.deepEqual(await otpHistory(pool, "0900000002", "U1"), { phone: null, account: null });
    assert.equal(await countOtpPhones(pool), 0);
    await logEvent(pool, { event: "otp_sent", sub: "U1", phone: "0900000002" });
    await logEvent(pool, { event: "login_binding", sub: "U1", phone: "0900000002" });
    assert.deepEqual(await otpHistory(pool, "0900000002", "U1"), { phone: null, account: null });
    await pool.query(
      "INSERT INTO login_events (line_sub, phone, event, at) VALUES ('U1', '0900000002', 'login_otp', now() - interval '200 days'), ('U1', '0900000002', 'login_otp', now() - interval '20 days'), ('U2', '0611111111', 'login_otp', now())",
    );
    const days = (d: Date | null) => (d ? (Date.now() - d.getTime()) / 86_400_000 : NaN);
    const same = await otpHistory(pool, "0900000002", "U1");
    assert.ok(days(same.phone) > 19 && days(same.phone) < 21, `latest of the two: ${days(same.phone)}`);
    assert.ok(days(same.account) > 19 && days(same.account) < 21);
    const other = await otpHistory(pool, "0900000002", "U9");
    assert.ok(days(other.phone) > 19 && days(other.phone) < 21);
    assert.equal(other.account, null, "a new LINE account has no history of its own");
    assert.equal(await countOtpPhones(pool), 2);
  });
});
