import "server-only";
import { createHash, createHmac } from "node:crypto";
import { POSITIONS, type AccessRequest, type Position, type TelegramRef } from "./access";
import { appUrl, ConfigError, onVercel, sessionSecret, telegramConfig, type TelegramConfig } from "./env";
import type { OtpHistory } from "./otp";
import type { Physician } from "./physician-list";
import { deriveKey } from "./tokens";

/** Public route for Telegram button taps (proxy.ts lets it through without a session or Origin). */
export const TELEGRAM_WEBHOOK_PATH = "/api/telegram/webhook";

export interface VerifiedAlert {
  /** Name and department from the physicians table (active or not); null if the email has no row. */
  physician: Physician | null;
  /** Name and position from the approved access request, for emails without a physicians row. */
  requester?: { firstName: string; lastName: string; position: Position } | null;
  /** LINE display name: attacker-controlled, so it is flattened and escaped. */
  lineName: string;
  email: string;
  at: Date;
  /** Earlier code verifications of this email (any LINE account) and of this email by this LINE account. */
  history: OtpHistory;
  /** Distinct emails that have ever verified with a code, including this one. */
  verifiedEmails: number;
}

const TZ = "Asia/Bangkok";
const SEND_TIMEOUT_MS = 8_000;
const TELEGRAM_API = "https://api.telegram.org";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One line, no control or bidi-override characters. */
function flat(s: string): string {
  return s
    .replace(/[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A free-form user-supplied value (e.g. a LINE name), as one escaped line of at most 100 characters. */
function text(s: string): string {
  const v = flat(s);
  return escapeHtml(v.length > 100 ? `${v.slice(0, 99)}…` : v);
}

/**
 * A value validated before it was stored (normalized email: ASCII, at most 254 characters; names: letters,
 * spaces and . - ', at most 60 each), escaped and never shortened: whoever approves must see the whole
 * address, above all its domain.
 */
function whole(s: string): string {
  return escapeHtml(flat(s));
}

function thaiDate(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(d);
}

function thaiTime(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

/** "25 ต.ค. 2569 16:30 น." in Bangkok time. */
export function thaiDateTime(d: Date): string {
  return `${thaiDate(d)} ${thaiTime(d)} น.`;
}

/** Telegram HTML message for a successful email-code verification. */
export function buildVerifiedAlert(a: VerifiedAlert): string {
  // A known email on a LINE account that never verified it before is flagged: it may not be the physician.
  const header =
    a.history.email === null
      ? "🆕 <b>ผู้ใช้ใหม่ยืนยันตัวตนสำเร็จ</b>"
      : a.history.account === null
        ? "⚠️ <b>บัญชี LINE ใหม่ของอีเมลที่เคยยืนยันแล้ว</b>"
        : "🔁 <b>ยืนยันตัวตนอีกครั้ง</b>";
  const who = a.physician
    ? `แพทย์: ${text(a.physician.name)}${a.physician.dept ? ` (${text(a.physician.dept)})` : ""}`
    : a.requester
      ? `${POSITIONS[a.requester.position]}: ${whole(a.requester.firstName)} ${whole(a.requester.lastName)} (อนุมัติจากคำขอ)`
      : "แพทย์: ไม่พบในรายชื่อแพทย์";
  const lines = [
    header,
    "ORSKH.APP ตารางห้องผ่าตัด",
    "",
    `🩺 ${who}`,
    `👤 ชื่อ LINE: ${text(a.lineName) || "ไม่ระบุ"}`,
    `📧 อีเมล: ${whole(a.email)}`,
    `🕒 เวลา: ${thaiDateTime(a.at)}`,
  ];
  if (a.history.email) lines.push(`🗓 อีเมลนี้ยืนยันครั้งก่อน: ${thaiDate(a.history.email)}`);
  lines.push(`👥 ยืนยันแล้วทั้งหมด: ${a.verifiedEmails.toLocaleString("th-TH")} อีเมล`);
  return lines.join("\n");
}

/** Telegram HTML message when unusually many sign-in codes were mailed (see VOLUME_ALERT_PER_DAY in lib/otp.ts). */
export function buildVolumeAlert(sentToday: number, at: Date): string {
  return [
    "⚠️ <b>มีการขอรหัสทางอีเมลมากผิดปกติ</b>",
    "ORSKH.APP ตารางห้องผ่าตัด",
    "",
    `📨 ส่งรหัสไปแล้ว ${sentToday.toLocaleString("th-TH")} ครั้งใน 24 ชั่วโมงที่ผ่านมา`,
    "อีเมลที่ใช้ส่งรหัสมีโควตาต่อวัน ถ้าเกินโควตา ผู้ใช้ใหม่จะไม่ได้รับรหัส ตรวจสอบตาราง otp_codes",
    `🕒 เวลา: ${thaiDateTime(at)}`,
  ].join("\n");
}

/** Telegram HTML message asking an administrator to approve an access request. */
export function buildRequestMessage(r: AccessRequest): string {
  return [
    "📝 <b>คำขอเข้าใช้งาน (อีเมลไม่อยู่ในรายชื่อ)</b>",
    "ORSKH.APP ตารางห้องผ่าตัด",
    "",
    `👤 ชื่อ-นามสกุล: ${whole(r.firstName)} ${whole(r.lastName)}`,
    `💼 ตำแหน่ง: ${POSITIONS[r.position]}`,
    `📧 อีเมล: ${whole(r.email)} (ยืนยันรหัสแล้ว)`,
    `💬 ชื่อ LINE: ${text(r.lineName ?? "") || "ไม่ระบุ"}`,
    `🕒 เวลา: ${thaiDateTime(r.createdAt)}`,
  ].join("\n");
}

/** The request message once decided (sent as an edit without buttons). */
export function buildDecidedMessage(r: AccessRequest, decision: "approved" | "rejected", at: Date): string {
  const verdict = decision === "approved" ? "✅ <b>อนุมัติแล้ว</b>" : "❌ <b>ไม่อนุมัติ</b>";
  return `${buildRequestMessage(r)}\n\n${verdict} · ${thaiDateTime(at)}`;
}

export type CallbackAction = "approve" | "reject";

/**
 * callback_data "ox:<request id>:a|r" (Telegram allows at most 64 bytes). The "ox" prefix is orskh's own: skh-or-schedule
 * uses "ar:" with the same numbering, so if both apps were ever set up with one bot (which has a single webhook), a tap
 * on the other app's message is refused as invalid here instead of deciding the local request with the same id.
 */
export function callbackData(id: string, action: CallbackAction): string {
  return `ox:${id}:${action === "approve" ? "a" : "r"}`;
}

export function parseCallbackData(v: unknown): { id: string; action: CallbackAction } | null {
  if (typeof v !== "string" || v.length > 64) return null;
  const m = /^ox:([1-9]\d{0,14}):([ar])$/.exec(v);
  return m ? { id: m[1], action: m[2] === "a" ? "approve" : "reject" } : null;
}

export function requestKeyboard(id: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ อนุมัติ", callback_data: callbackData(id, "approve") },
        { text: "❌ ไม่อนุมัติ", callback_data: callbackData(id, "reject") },
      ],
    ],
  };
}

/** Calls one Bot API method. Throws on failure; error messages never include the token. */
export async function callTelegram<T = unknown>(cfg: TelegramConfig, method: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cfg.apiUrl}/bot${cfg.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (e) {
    // Name only: undici messages can carry request details.
    throw new Error(`telegram request failed (${(e as Error).name})`);
  }
  const data = (await res.json().catch(() => null)) as { ok?: unknown; result?: unknown; description?: unknown } | null;
  if (!res.ok || data?.ok !== true) {
    const why = typeof data?.description === "string" ? data.description.slice(0, 200) : "";
    throw new Error(`telegram ${method} HTTP ${res.status}${why ? `: ${why}` : ""}`);
  }
  return data.result as T;
}

/** Sends an HTML message to every configured chat. Throws on the first failure; never includes the token. */
export async function sendTelegram(html: string): Promise<boolean> {
  const cfg = telegramConfig();
  if (!cfg) return false;
  for (const chatId of cfg.chatIds) {
    await callTelegram(cfg, "sendMessage", {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  }
  return true;
}

/** Fire-and-forget alert: logs problems, never throws, never blocks or fails a login. */
export async function notifyVerified(a: VerifiedAlert): Promise<void> {
  await notify(buildVerifiedAlert(a));
}

/** Fire-and-forget alert about the number of codes mailed; never throws. */
export async function notifyVolume(sentToday: number): Promise<void> {
  await notify(buildVolumeAlert(sentToday, new Date()));
}

async function notify(html: string): Promise<void> {
  try {
    await sendTelegram(html);
  } catch (e) {
    if (e instanceof ConfigError) console.error("[alert] telegram not configured:", e.names.join(", "));
    else console.error("[alert]", (e as Error).message);
  }
}

/**
 * Sends the request with its two buttons to every configured chat; a failing chat is logged and skipped.
 * Returns the messages that were sent, to be edited after the decision.
 */
export async function sendRequestMessages(r: AccessRequest): Promise<TelegramRef[]> {
  const cfg = telegramConfig();
  if (!cfg) return [];
  const sent: TelegramRef[] = [];
  for (const chatId of cfg.chatIds) {
    try {
      const m = await callTelegram<{ message_id?: unknown } | null>(cfg, "sendMessage", {
        chat_id: chatId,
        text: buildRequestMessage(r),
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: requestKeyboard(r.id),
      });
      const id = m?.message_id;
      if (typeof id === "number" && Number.isSafeInteger(id)) sent.push({ chat_id: chatId, message_id: id });
    } catch (e) {
      console.error("[access] request message failed:", (e as Error).message);
    }
  }
  return sent;
}

/** Replaces each request message with the decided text. No reply_markup: the buttons disappear. */
export async function markDecided(refs: TelegramRef[], html: string): Promise<void> {
  const cfg = telegramConfig();
  if (!cfg) return;
  for (const ref of refs) {
    try {
      await callTelegram(cfg, "editMessageText", {
        chat_id: ref.chat_id,
        message_id: ref.message_id,
        text: html,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch (e) {
      console.error("[access] editing request message failed:", (e as Error).message);
    }
  }
}

/** Short notice shown to whoever tapped a button. Never throws. */
export async function answerCallback(callbackQueryId: string, message: string): Promise<void> {
  try {
    const cfg = telegramConfig();
    if (cfg) await callTelegram(cfg, "answerCallbackQuery", { callback_query_id: callbackQueryId, text: message });
  } catch (e) {
    console.error("[access] answerCallbackQuery failed:", (e as Error).message);
  }
}

/**
 * Secret Telegram sends in X-Telegram-Bot-Api-Secret-Token: HMAC-SHA256(HKDF(SESSION_SECRET, "telegram-webhook"),
 * bot token) as base64url (43 characters of [A-Za-z0-9_-]). Derived, so there is no extra setting; it changes
 * when either secret is rotated; the next access request, or the first refused webhook call (healWebhook()),
 * then registers the new one.
 */
export function webhookSecret(botToken: string, secret: string): string {
  return createHmac("sha256", deriveKey(secret, "telegram-webhook")).update(botToken, "utf8").digest("base64url");
}

/** Numeric ids in TELEGRAM_CHAT_ID: the people allowed to decide (a private chat's id is the user's id). */
export function adminIds(cfg: TelegramConfig): Set<string> {
  return new Set(cfg.chatIds.filter((id) => /^\d{1,20}$/.test(id)));
}

/**
 * getWebhookInfo does not return the secret, so the registered URL carries a short fingerprint of it:
 * a rotated secret shows up as a different URL and is registered again.
 */
export function webhookUrl(origin: string, secret: string): string {
  const fp = createHash("sha256").update(`webhook-fingerprint|${secret}`).digest("hex").slice(0, 12);
  return `${origin}${TELEGRAM_WEBHOOK_PATH}?v=${fp}`;
}

let registered: string | null = null;
let registering: Promise<boolean> | null = null;

/**
 * Makes sure Telegram delivers button taps here: getWebhookInfo, then setWebhook when the URL (and with it the
 * secret) or allowed_updates are not ours. Success is remembered per server instance. Telegram only accepts
 * https; plain http is allowed only off Vercel with a TELEGRAM_API_URL override (tests).
 */
export async function ensureWebhook(): Promise<boolean> {
  const cfg = telegramConfig();
  if (!cfg) return false;
  const app = appUrl();
  if (app.protocol !== "https:" && (onVercel() || cfg.apiUrl === TELEGRAM_API)) {
    throw new Error("telegram webhook needs an https APP_URL");
  }
  const secret = webhookSecret(cfg.token, sessionSecret());
  const url = webhookUrl(app.origin, secret);
  const key = createHash("sha256").update(`${cfg.apiUrl}|${cfg.token}|${url}`).digest("hex");
  if (registered === key) return true;
  registering ??= (async () => {
    try {
      const info = await callTelegram<{ url?: unknown; allowed_updates?: unknown } | null>(cfg, "getWebhookInfo", {});
      const updates = Array.isArray(info?.allowed_updates) ? info.allowed_updates : [];
      if (info?.url !== url || updates.length !== 1 || updates[0] !== "callback_query") {
        await callTelegram(cfg, "setWebhook", { url, secret_token: secret, allowed_updates: ["callback_query"] });
        console.info("[access] telegram webhook registered");
      }
      registered = key;
      return true;
    } finally {
      registering = null;
    }
  })();
  return registering;
}

const HEAL_EVERY_MS = 60_000;
let lastHeal = -Infinity;

/**
 * For a webhook call with a wrong secret. After SESSION_SECRET or the bot token is rotated, Telegram keeps sending
 * the old secret until setWebhook runs again, so every tap would be refused until the next access request.
 * This registers the current secret instead: nothing to do once this instance registered it, and at most one
 * attempt a minute, so refused calls cannot drive Bot API traffic. Telegram's retry then carries the new secret.
 * Never throws.
 */
export async function healWebhook(): Promise<void> {
  const now = Date.now();
  if (now - lastHeal < HEAL_EVERY_MS) return;
  lastHeal = now;
  try {
    await ensureWebhook();
  } catch (e) {
    console.error("[access] webhook re-registration failed:", (e as Error).message);
  }
}

/** Tests only: forget the per-instance registration. */
export function resetWebhookMemo(): void {
  registered = null;
  registering = null;
  lastHeal = -Infinity;
}
