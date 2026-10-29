import "server-only";
import type { Pool } from "pg";
import { decideRequest, type DecideResult, type TelegramRef } from "./access";
import { noteApproved } from "./authz";
import { db } from "./db";
import { ConfigError, sessionSecret, telegramConfig, type TelegramConfig } from "./env";
import { logEvent } from "./otp";
import { safeEqual } from "./security";
import {
  adminIds,
  answerCallback,
  buildDecidedMessage,
  healWebhook,
  markDecided,
  parseCallbackData,
  webhookSecret,
} from "./telegram";

/** Largest update read (a callback_query carries the tapped message, a few KB). */
export const WEBHOOK_MAX_BYTES = 64 * 1024;

export interface WebhookReply {
  status: number;
  body: { ok: boolean };
}

/** Runs work after the response (next/server `after` in the route; a collector in tests). */
export type Defer = (task: () => Promise<void>) => void;

const OK: WebhookReply = { status: 200, body: { ok: true } };

// Shown to the person who tapped (answerCallbackQuery).
export const ANSWERS = {
  // Nothing is sent to the requester (no SMS, which would cost credit): their waiting page signs them in by itself.
  approved: "อนุมัติแล้ว หน้ารออนุมัติของผู้ขอจะเข้าสู่ระบบให้เอง",
  rejected: "บันทึกว่าไม่อนุมัติแล้ว",
  notAdmin: "คุณไม่มีสิทธิ์พิจารณาคำขอนี้",
  alreadyApproved: "คำขอนี้พิจารณาไปแล้ว (อนุมัติ)",
  alreadyRejected: "คำขอนี้พิจารณาไปแล้ว (ไม่อนุมัติ)",
  missing: "ไม่พบคำขอนี้",
  invalid: "คำสั่งไม่ถูกต้อง",
  failed: "บันทึกไม่สำเร็จ กรุณาลองใหม่",
} as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function positiveId(v: unknown): string | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
}

/** The message that was tapped, so it is edited even if storing the sent messages failed. */
function tappedMessage(m: unknown): TelegramRef | null {
  if (!isObject(m) || !isObject(m.chat)) return null;
  const chat = m.chat.id;
  const id = m.message_id;
  return typeof chat === "number" && Number.isSafeInteger(chat) && typeof id === "number" && Number.isSafeInteger(id)
    ? { chat_id: String(chat), message_id: id }
    : null;
}

/**
 * Handles one webhook call. Only Telegram knows the secret header (derived, see webhookSecret()); a wrong or
 * missing one is refused before the body is read, and the current secret is registered again in case Telegram
 * still sends one from before a rotation (healWebhook()). Authentic updates always get 200 quickly (Telegram
 * retries anything else): only callback_query taps on request buttons by an id in TELEGRAM_CHAT_ID change anything,
 * and the decision is a single conditional UPDATE, so a second tap or a redelivered update changes nothing.
 * Telegram calls run after the response. Request content is never echoed. The requester is not messaged: the waiting
 * page signs in by itself, and someone who closed it signs in again with LINE and an SMS code.
 */
export async function handleTelegramWebhook(
  headers: Headers,
  readBody: () => Promise<Record<string, unknown> | null>,
  defer: Defer,
): Promise<WebhookReply> {
  let cfg: TelegramConfig | null;
  let expected: string;
  try {
    cfg = telegramConfig();
    if (!cfg) return { status: 404, body: { ok: false } };
    expected = webhookSecret(cfg.token, sessionSecret());
  } catch (e) {
    if (e instanceof ConfigError) console.error("[access] webhook not configured:", e.names.join(", "));
    return { status: 503, body: { ok: false } };
  }
  if (!safeEqual(headers.get("x-telegram-bot-api-secret-token") ?? "", expected)) {
    defer(healWebhook);
    return { status: 401, body: { ok: false } };
  }

  const update = await readBody();
  const cq = update?.callback_query;
  if (!isObject(cq) || typeof cq.id !== "string" || cq.id.length === 0 || cq.id.length > 128) return OK;
  const queryId = cq.id;
  const reply = (text: string) => defer(() => answerCallback(queryId, text));

  const by = isObject(cq.from) ? positiveId(cq.from.id) : null;
  if (!by || !adminIds(cfg).has(by)) {
    reply(ANSWERS.notAdmin);
    return OK;
  }
  const action = parseCallbackData(cq.data);
  if (!action) {
    reply(ANSWERS.invalid);
    return OK;
  }

  let pool: Pool;
  let result: DecideResult;
  try {
    pool = await db();
    result = await decideRequest(pool, action.id, action.action === "approve" ? "approved" : "rejected", by);
  } catch (e) {
    console.error("[access] decision failed:", (e as Error).message);
    reply(ANSWERS.failed);
    return OK;
  }
  if (result.outcome === "missing") {
    reply(ANSWERS.missing);
    return OK;
  }
  const r = result.request;
  if (result.outcome === "already") {
    reply(r.status === "approved" ? ANSWERS.alreadyApproved : ANSWERS.alreadyRejected);
    return OK;
  }

  const approved = r.status === "approved";
  if (approved) noteApproved(r.phone);
  await logEvent(pool, { event: approved ? "access_approved" : "access_rejected", sub: r.lineSub, phone: r.phone });
  const refs = [...r.tgMessages];
  const tapped = tappedMessage(cq.message);
  if (tapped && !refs.some((x) => x.chat_id === tapped.chat_id && x.message_id === tapped.message_id)) refs.push(tapped);
  const html = buildDecidedMessage(r, approved ? "approved" : "rejected", r.decidedAt ?? new Date());
  defer(async () => {
    await answerCallback(queryId, approved ? ANSWERS.approved : ANSWERS.rejected);
    await markDecided(refs, html);
  });
  return OK;
}
