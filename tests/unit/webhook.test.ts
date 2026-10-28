import "./_setup";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { createRequest, getRequest, saveTelegramRefs, type AccessRequest } from "@/lib/access";
import { isAuthorizedEmail, resetAuthzCache } from "@/lib/authz";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import {
  buildDecidedMessage,
  buildRequestMessage,
  callbackData,
  ensureWebhook,
  parseCallbackData,
  requestKeyboard,
  resetWebhookMemo,
  sendRequestMessages,
  TELEGRAM_WEBHOOK_PATH,
  webhookSecret,
  webhookUrl,
} from "@/lib/telegram";
import { ANSWERS, handleTelegramWebhook } from "@/lib/telegram-webhook";
import { setTestEnv, TEST_SESSION_SECRET } from "./_setup";

const TOKEN = "123456789:AAtestTOKENtestTOKENtestTOKEN_x-y";
const ADMIN = 111;
const ADMIN_2 = 222;
const GROUP = "-1001234567890";

const REQUEST: AccessRequest = {
  id: "42",
  email: "newcomer@example.com",
  lineSub: "U1",
  lineName: "Som",
  firstName: "สมชาย",
  lastName: "ใจดี",
  position: "nurse",
  status: "pending",
  createdAt: new Date("2026-10-25T09:30:00Z"), // 16:30 in Bangkok
  decidedAt: null,
  decidedBy: null,
  tgMessages: [],
};

describe("Telegram request message", () => {
  test("exact layout (HTML, Bangkok time)", () => {
    assert.equal(
      buildRequestMessage(REQUEST),
      [
        "📝 <b>คำขอเข้าใช้งาน (อีเมลไม่อยู่ในรายชื่อ)</b>",
        "ORSKH.APP ตารางห้องผ่าตัด",
        "",
        "👤 ชื่อ-นามสกุล: สมชาย ใจดี",
        "💼 ตำแหน่ง: พยาบาล",
        "📧 อีเมล: newcomer@example.com (ยืนยันรหัสแล้ว)",
        "💬 ชื่อ LINE: Som",
        "🕒 เวลา: 25 ต.ค. 2569 16:30 น.",
      ].join("\n"),
    );
    assert.match(buildRequestMessage({ ...REQUEST, position: "doctor" }), /\n💼 ตำแหน่ง: แพทย์\n/);
    assert.match(buildRequestMessage({ ...REQUEST, lineName: null }), /\n💬 ชื่อ LINE: ไม่ระบุ\n/);
    assert.match(buildRequestMessage({ ...REQUEST, lineName: " ‮ " }), /\n💬 ชื่อ LINE: ไม่ระบุ\n/);
  });

  test("every value is escaped and flattened to one line", () => {
    const html = buildRequestMessage({
      ...REQUEST,
      lineName: '<a href="https://evil.test">x</a>\n📧 อีเมล: boss@example.com‮',
      email: "a&b@example.com",
    });
    const lines = html.split("\n");
    assert.equal(lines.length, 8);
    assert.equal(lines.filter((l) => l.startsWith("📧")).length, 1, "no injected line");
    assert.ok(lines[6].includes("&lt;a href=") && !lines[6].includes("<a"), lines[6]);
    assert.ok(!html.includes("‮"));
    assert.ok(lines[5].includes("a&amp;b@example.com"));
  });

  test("long addresses and names are shown in full: the domain the approver sees is the one that gets the mail", () => {
    // A long local part (over 200 characters) and a long domain made to look like the hospital's at its start.
    const longLocal = `${"somchai.jaidee.".repeat(13)}x@example.com`;
    const lookalike = ["samutsakhon-hospital", "moph", "go", "th", "x".repeat(60), "attacker", "example", "com"].join(".");
    const longDomain = `somchai.jaidee@${lookalike}`;
    const first = "ก".repeat(60);
    const last = "ข".repeat(60);
    const at = new Date("2026-10-25T10:05:00Z");
    for (const email of [longLocal, longDomain]) {
      assert.equal(normalizeEmail(email), email, "a valid address");
      assert.ok(email.length > 100);
      const r = { ...REQUEST, email, firstName: first, lastName: last };
      for (const html of [buildRequestMessage(r), buildDecidedMessage(r, "approved", at), buildDecidedMessage(r, "rejected", at)]) {
        assert.ok(html.includes(`\n📧 อีเมล: ${email} (ยืนยันรหัสแล้ว)\n`), html);
        assert.ok(html.includes(`\n👤 ชื่อ-นามสกุล: ${first} ${last}\n`), "the whole name");
        assert.ok(!html.includes("…"), "nothing shortened");
      }
    }
    assert.ok(buildRequestMessage({ ...REQUEST, email: longDomain }).includes(".attacker.example.com (ยืนยันรหัสแล้ว)"));
  });

  test("two buttons in one row; callback_data names the request and the action in <= 64 bytes", () => {
    assert.deepEqual(requestKeyboard("42"), {
      inline_keyboard: [
        [
          { text: "✅ อนุมัติ", callback_data: "ox:42:a" },
          { text: "❌ ไม่อนุมัติ", callback_data: "ox:42:r" },
        ],
      ],
    });
    for (const action of ["approve", "reject"] as const) {
      const data = callbackData("999999999999999", action);
      assert.ok(Buffer.byteLength(data) <= 64, data);
      assert.deepEqual(parseCallbackData(data), { id: "999999999999999", action });
    }
  });

  test("callback_data parsing refuses anything else", () => {
    assert.deepEqual(parseCallbackData("ox:7:a"), { id: "7", action: "approve" });
    assert.deepEqual(parseCallbackData("ox:7:r"), { id: "7", action: "reject" });
    // "ar:7:a" is skh-or-schedule's format: a tap on its messages must not decide a request here.
    for (const bad of ["", "ox:7", "ox:7:x", "ox:0:a", "ox:07:a", "ox:-7:a", "ox:7:a ", "xx:7:a", "ar:7:a", "ar:7:r", "ox:1234567890123456:a", "ox:7:a:b", null, 7, {}]) {
      assert.equal(parseCallbackData(bad), null, JSON.stringify(bad));
    }
  });

  test("decided edit: the same text, a blank line and the verdict with its Bangkok time", () => {
    const at = new Date("2026-10-25T10:05:00Z");
    assert.equal(buildDecidedMessage(REQUEST, "approved", at), `${buildRequestMessage(REQUEST)}\n\n✅ <b>อนุมัติแล้ว</b> · 25 ต.ค. 2569 17:05 น.`);
    assert.equal(buildDecidedMessage(REQUEST, "rejected", at), `${buildRequestMessage(REQUEST)}\n\n❌ <b>ไม่อนุมัติ</b> · 25 ต.ค. 2569 17:05 น.`);
  });
});

describe("webhook secret", () => {
  test("derived from the bot token and SESSION_SECRET; URL-safe; changes with either", () => {
    const s = webhookSecret(TOKEN, TEST_SESSION_SECRET);
    assert.match(s, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(s, webhookSecret(TOKEN, TEST_SESSION_SECRET));
    assert.notEqual(s, webhookSecret(`${TOKEN}x`, TEST_SESSION_SECRET));
    assert.notEqual(s, webhookSecret(TOKEN, `${TEST_SESSION_SECRET}x`));
    assert.ok(!s.includes(TOKEN.split(":")[1].slice(0, 8)));
    const url = webhookUrl("https://orskh.vercel.app", s);
    assert.match(url, /^https:\/\/orskh\.vercel\.app\/api\/telegram\/webhook\?v=[0-9a-f]{12}$/);
    assert.ok(!url.includes(s), "the URL never carries the secret itself");
    assert.notEqual(url, webhookUrl("https://orskh.vercel.app", `${s}x`));
  });
});

describe("Telegram webhook and Bot API (mock)", () => {
  let server: Server;
  let base = "";
  let outbox = "";
  const calls: { method: string; token: string; body: Record<string, unknown> }[] = [];
  const failing = new Set<string>();
  let webhook = { url: "", allowed_updates: [] as string[] };
  let nextMessageId = 100;
  let cb = 0;

  before(async () => {
    server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? "");
        const body = JSON.parse(data || "{}");
        const method = m?.[2] ?? "";
        calls.push({ method, token: m?.[1] ?? "", body });
        const reply = (status: number, payload: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        if (failing.has(method)) return reply(400, { ok: false, description: "Bad Request: message to edit not found" });
        if (method === "sendMessage") return reply(200, { ok: true, result: { message_id: nextMessageId++ } });
        if (method === "getWebhookInfo") return reply(200, { ok: true, result: { ...webhook, pending_update_count: 0 } });
        if (method === "setWebhook") {
          webhook = { url: body.url, allowed_updates: body.allowed_updates };
          return reply(200, { ok: true, result: true });
        }
        return reply(200, { ok: true, result: true });
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    configure();
    await (await db()).query("TRUNCATE access_requests, login_events RESTART IDENTITY");
  });
  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await (await db()).end();
  });
  beforeEach(() => {
    setTestEnv();
    configure();
    calls.length = 0;
    failing.clear();
    resetWebhookMemo();
  });

  function configure() {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_CHAT_ID = `${ADMIN}, ${ADMIN_2}, ${GROUP}`;
    process.env.TELEGRAM_API_URL = base;
    outbox ||= mkdtempSync(join(tmpdir(), "orskh-webhook-outbox-"));
    process.env.EMAIL_TRANSPORT = "file";
    process.env.EMAIL_OUTBOX_DIR = outbox;
  }

  const secret = () => webhookSecret(TOKEN, TEST_SESSION_SECRET);

  function tap(data: unknown, from: unknown = ADMIN, message: unknown = undefined) {
    return {
      update_id: ++cb,
      callback_query: {
        id: `cbq-${cb}`,
        from: { id: from, is_bot: false, first_name: "Admin" },
        chat_instance: "1",
        data,
        ...(message === undefined ? {} : { message }),
      },
    };
  }

  /** Runs the handler like the route does, then the deferred work (after the response). */
  async function post(update: unknown, header: string | null = secret()) {
    const tasks: (() => Promise<void>)[] = [];
    let read = false;
    const headers = new Headers({ "content-type": "application/json" });
    if (header !== null) headers.set("x-telegram-bot-api-secret-token", header);
    const reply = await handleTelegramWebhook(
      headers,
      async () => {
        read = true;
        return update as Record<string, unknown> | null;
      },
      (t) => void tasks.push(t),
    );
    for (const t of tasks) await t();
    return { ...reply, read };
  }

  async function newRequest(email: string, sub = "U1"): Promise<AccessRequest> {
    const r = await createRequest(await db(), {
      email,
      sub,
      lineName: "Som",
      firstName: "สมชาย",
      lastName: "ใจดี",
      position: "nurse",
      ip: "203.0.113.5",
    });
    assert.ok(r.status === "created");
    return r.request;
  }

  const answers = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body.text);

  test("wrong or missing secret: 401, body not read, nothing changes (the webhook is registered again once)", async () => {
    const r = await newRequest("secret@example.com");
    webhook = { url: "", allowed_updates: [] };
    for (const header of [null, "", "wrong", `${secret()}x`, secret().slice(1)]) {
      const res = await post(tap(callbackData(r.id, "approve")), header);
      assert.equal(res.status, 401, String(header));
      assert.deepEqual(res.body, { ok: false });
      assert.equal(res.read, false, "the update is not even read");
    }
    assert.deepEqual(
      calls.map((c) => c.method),
      ["getWebhookInfo", "setWebhook"],
      "only a re-registration (at most once a minute), no answer, edit or message",
    );
    assert.equal(calls[1].body.secret_token, secret());
    assert.equal((await getRequest(await db(), r.id))?.status, "pending");
    // registered on this instance: later refused calls cost nothing, even after the minute
    resetWebhookMemo();
    await ensureWebhook();
    calls.length = 0;
    await post(tap(callbackData(r.id, "approve")), "wrong");
    assert.deepEqual(calls.map((c) => c.method), [], "memoized");
    // Telegram not configured: nothing to authenticate against
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal((await post(tap(callbackData(r.id, "approve")))).status, 404);
  });

  test("malformed or other updates: 200 and ignored", async () => {
    for (const update of [
      null,
      {},
      { update_id: 1, message: { text: "/start" } },
      { update_id: 2, callback_query: "x" },
      { update_id: 3, callback_query: { from: { id: ADMIN }, data: "ox:1:a" } },
      { update_id: 4, callback_query: { id: "", from: { id: ADMIN }, data: "ox:1:a" } },
    ]) {
      const res = await post(update);
      assert.equal(res.status, 200, JSON.stringify(update));
      assert.deepEqual(res.body, { ok: true });
    }
    assert.equal(calls.length, 0);
    const bad = await post(tap("drop table", ADMIN));
    assert.equal(bad.status, 200);
    assert.deepEqual(answers(), [ANSWERS.invalid]);
  });

  test("a tap on skh-or-schedule's buttons (same bot, same numbering) is refused and the same-numbered request stays pending", async () => {
    const r = await newRequest("same-number@example.com", "U-skh");
    const tapped = { message_id: 501, chat: { id: ADMIN, type: "private" }, date: 0, text: "skh request" };
    for (const data of [`ar:${r.id}:a`, `ar:${r.id}:r`]) {
      const res = await post(tap(data, ADMIN, tapped));
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { ok: true });
    }
    assert.deepEqual(answers(), [ANSWERS.invalid, ANSWERS.invalid]);
    assert.equal(calls.filter((c) => c.method !== "answerCallbackQuery").length, 0, "the other app's message is not edited, no email");
    assert.equal((await getRequest(await db(), r.id))?.status, "pending");
  });

  test("a tapper whose id is not in TELEGRAM_CHAT_ID is refused and nothing changes", async () => {
    const r = await newRequest("outsider@example.com");
    for (const from of [333, Number(GROUP), "111", null, 1.5]) {
      const res = await post(tap(callbackData(r.id, "approve"), from));
      assert.equal(res.status, 200);
    }
    assert.deepEqual(answers(), Array(5).fill(ANSWERS.notAdmin));
    assert.equal(calls.filter((c) => c.method !== "answerCallbackQuery").length, 0, "no edit, no email");
    assert.equal((await getRequest(await db(), r.id))?.status, "pending");
  });

  test("approve: decided atomically, messages edited without buttons, requester emailed, email authorized", async () => {
    const r = await newRequest("approve-me@example.com");
    await saveTelegramRefs(await db(), r.id, [
      { chat_id: String(ADMIN), message_id: 77 },
      { chat_id: String(ADMIN_2), message_id: 78 },
    ]);
    resetAuthzCache();
    assert.equal(await isAuthorizedEmail(r.email), false);
    const before = readdirSync(outbox).length;
    const tapped = { message_id: 77, chat: { id: ADMIN, type: "private" }, date: 0, text: "…" };
    const res = await post(tap(callbackData(r.id, "approve"), ADMIN, tapped));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true }, "nothing from the update is echoed");

    const row = await getRequest(await db(), r.id);
    assert.equal(row?.status, "approved");
    assert.equal(row?.decidedBy, String(ADMIN));
    assert.ok(row?.decidedAt instanceof Date);
    assert.deepEqual(answers(), [ANSWERS.approved]);
    // answered before the email goes out: it says the email will be sent, not that it was
    assert.equal(ANSWERS.approved, "อนุมัติแล้ว ระบบจะส่งอีเมลแจ้งผู้ขอ");
    const edits = calls.filter((c) => c.method === "editMessageText");
    assert.deepEqual(
      edits.map((e) => [e.body.chat_id, e.body.message_id]),
      [
        [String(ADMIN), 77],
        [String(ADMIN_2), 78],
      ],
      "each stored message once (the tapped one is not edited twice)",
    );
    for (const e of edits) {
      assert.equal(e.body.parse_mode, "HTML");
      assert.equal(e.body.reply_markup, undefined, "buttons removed");
      assert.match(String(e.body.text), /\n\n✅ <b>อนุมัติแล้ว<\/b> · \d{1,2} \S+ \d{4} \d{2}:\d{2} น\.$/);
      assert.ok(String(e.body.text).startsWith(buildRequestMessage(r)));
    }
    const mails = readdirSync(outbox).sort().slice(before);
    assert.equal(mails.length, 1);
    const mail = JSON.parse(readFileSync(join(outbox, mails[0]), "utf8"));
    assert.equal(mail.to, r.email);
    assert.equal(mail.subject, "อนุมัติการเข้าใช้งานแล้ว · ORSKH.APP ตารางห้องผ่าตัด");
    assert.equal(await isAuthorizedEmail(r.email), true, "this instance knows at once");
    const ev = await (await db()).query("SELECT line_sub FROM login_events WHERE event = 'access_approved' AND email = $1", [r.email]);
    assert.deepEqual(ev.rows, [{ line_sub: "U1" }]);

    // second tap (any button, any admin): already decided, nothing changes
    calls.length = 0;
    const again = await post(tap(callbackData(r.id, "reject"), ADMIN_2));
    assert.equal(again.status, 200);
    assert.deepEqual(answers(), [ANSWERS.alreadyApproved]);
    assert.equal(calls.length, 1, "no edit and no email");
    assert.equal((await getRequest(await db(), r.id))?.status, "approved");
    assert.equal(readdirSync(outbox).length, before + 1);
  });

  test("reject: edited with the verdict, no email; the tapped message is edited even if none was stored", async () => {
    const r = await newRequest("reject-me@example.com", "U2");
    const before = readdirSync(outbox).length;
    const tapped = { message_id: 91, chat: { id: ADMIN_2, type: "private" }, date: 0 };
    await post(tap(callbackData(r.id, "reject"), ADMIN_2, tapped));
    assert.equal((await getRequest(await db(), r.id))?.status, "rejected");
    assert.deepEqual(answers(), [ANSWERS.rejected]);
    const edits = calls.filter((c) => c.method === "editMessageText");
    assert.equal(edits.length, 1);
    assert.deepEqual([edits[0].body.chat_id, edits[0].body.message_id], [String(ADMIN_2), 91]);
    assert.match(String(edits[0].body.text), /\n\n❌ <b>ไม่อนุมัติ<\/b> · /);
    assert.equal(readdirSync(outbox).length, before, "no email on rejection");
    calls.length = 0;
    await post(tap(callbackData(r.id, "approve")));
    assert.deepEqual(answers(), [ANSWERS.alreadyRejected]);
    assert.equal((await getRequest(await db(), r.id))?.status, "rejected");
  });

  test("unknown request id; Telegram errors are logged without the token and never thrown", async () => {
    await post(tap(callbackData("987654", "approve")));
    assert.deepEqual(answers(), [ANSWERS.missing]);

    const r = await newRequest("flaky@example.com", "U3");
    await saveTelegramRefs(await db(), r.id, [{ chat_id: String(ADMIN), message_id: 5 }]);
    failing.add("editMessageText");
    failing.add("answerCallbackQuery");
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
    try {
      const res = await post(tap(callbackData(r.id, "approve")));
      assert.equal(res.status, 200);
    } finally {
      console.error = orig;
    }
    assert.equal((await getRequest(await db(), r.id))?.status, "approved", "the decision stands");
    assert.equal(logged.length, 2, logged.join(" | "));
    for (const l of logged) assert.ok(!l.includes(TOKEN) && /HTTP 400/.test(l), l);
  });

  test("request messages go to every chat with the buttons; a failing chat is skipped", async () => {
    const sent = await sendRequestMessages(REQUEST);
    assert.equal(sent.length, 3);
    const msgs = calls.filter((c) => c.method === "sendMessage");
    assert.deepEqual(
      msgs.map((m) => m.body.chat_id),
      [String(ADMIN), String(ADMIN_2), GROUP],
    );
    for (const m of msgs) {
      assert.equal(m.token, TOKEN);
      assert.equal(m.body.parse_mode, "HTML");
      assert.equal(m.body.text, buildRequestMessage(REQUEST));
      assert.deepEqual(m.body.reply_markup, requestKeyboard(REQUEST.id));
    }
    calls.length = 0;
    failing.add("sendMessage");
    const orig = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await sendRequestMessages(REQUEST), []);
    } finally {
      console.error = orig;
    }
    assert.equal(calls.length, 3, "every chat was tried");
  });

  test("after a secret rotation the first refused tap registers the new secret, and Telegram's retry decides", async () => {
    webhook = { url: "", allowed_updates: [] };
    await ensureWebhook(); // registered before the rotation
    const old = secret();
    const r = await newRequest("rotated@example.com", "U4");
    process.env.SESSION_SECRET = `${TEST_SESSION_SECRET}-rotated`; // redeployed with a new SESSION_SECRET
    const current = webhookSecret(TOKEN, process.env.SESSION_SECRET);
    calls.length = 0;
    const refused = await post(tap(callbackData(r.id, "approve")), old);
    assert.equal(refused.status, 401);
    assert.deepEqual(calls.map((c) => c.method), ["getWebhookInfo", "setWebhook"]);
    assert.equal(calls[1].body.secret_token, current);
    assert.equal(calls[1].body.url, webhookUrl("http://localhost:3999", current));
    assert.equal((await getRequest(await db(), r.id))?.status, "pending");
    calls.length = 0;
    await post(tap(callbackData(r.id, "approve")), old);
    assert.equal(calls.length, 0, "no more Bot API calls for refused calls");
    const retried = await post(tap(callbackData(r.id, "approve")), current);
    assert.equal(retried.status, 200);
    assert.equal((await getRequest(await db(), r.id))?.status, "approved");
  });

  test("ensureWebhook: registers once per instance; again when the secret changes", async () => {
    resetWebhookMemo();
    webhook = { url: "", allowed_updates: [] };
    assert.equal(await ensureWebhook(), true);
    const set = calls.filter((c) => c.method === "setWebhook");
    assert.equal(set.length, 1);
    assert.equal(set[0].body.url, webhookUrl("http://localhost:3999", secret()));
    assert.ok(String(set[0].body.url).startsWith(`http://localhost:3999${TELEGRAM_WEBHOOK_PATH}?v=`));
    assert.equal(set[0].body.secret_token, secret());
    assert.deepEqual(set[0].body.allowed_updates, ["callback_query"]);

    calls.length = 0;
    assert.equal(await ensureWebhook(), true);
    assert.equal(calls.length, 0, "memoized");

    resetWebhookMemo();
    assert.equal(await ensureWebhook(), true);
    assert.deepEqual(calls.map((c) => c.method), ["getWebhookInfo"], "already ours: no setWebhook");

    calls.length = 0;
    process.env.SESSION_SECRET = `${TEST_SESSION_SECRET}-rotated`;
    assert.equal(await ensureWebhook(), true);
    assert.deepEqual(calls.map((c) => c.method), ["getWebhookInfo", "setWebhook"]);
    assert.notEqual(calls[1].body.secret_token, secret());

    // someone else's webhook (or the old one without our allowed_updates) is replaced
    resetWebhookMemo();
    calls.length = 0;
    webhook = { ...webhook, allowed_updates: ["message", "callback_query"] };
    await ensureWebhook();
    assert.deepEqual(calls.map((c) => c.method), ["getWebhookInfo", "setWebhook"]);
  });

  test("ensureWebhook: real Telegram (no override) needs https; http is refused without any call", async () => {
    resetWebhookMemo();
    delete process.env.TELEGRAM_API_URL;
    await assert.rejects(ensureWebhook(), /https APP_URL/);
    process.env.TELEGRAM_API_URL = base;
    process.env.VERCEL = "1";
    await assert.rejects(ensureWebhook(), /https APP_URL/);
    assert.equal(calls.length, 0);
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal(await ensureWebhook(), false, "off when Telegram is not configured");
  });
});
