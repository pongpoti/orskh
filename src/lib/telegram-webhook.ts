import "server-only";
import type { Pool } from "pg";
import { decideRequest, isApproved, type DecideResult, type TelegramRef } from "./access";
import { noteAuthorized, noteRevoked } from "./authz";
import { db } from "./db";
import { ConfigError, sessionSecret, telegramConfig, type TelegramConfig } from "./env";
import { logEvent } from "./otp";
import { isAllowedPhone } from "./phone";
import { safeEqual } from "./security";
import { undoClaim, type UndoResult } from "./user-list";
import {
  adminIds,
  answerCallback,
  buildClaimUndoneMessage,
  buildDecidedMessage,
  healWebhook,
  markDecided,
  parseCallbackData,
  parseClaimCallbackData,
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
  // undo of a claimed name ("oc:<claim id>:u")
  claimUndone: "ยกเลิกการยืนยันชื่อแล้ว ผู้ใช้นี้จะออกจากระบบภายใน 1 นาที",
  // the number stays authorized by an approved access request or ALLOWED_PHONES (revoke those on their own)
  claimUndoneStillAllowed: "ยกเลิกการยืนยันชื่อแล้ว แต่เบอร์นี้ยังเข้าใช้งานได้ เพราะมีคำขอที่อนุมัติแล้วหรืออยู่ใน ALLOWED_PHONES",
  claimAlready: "ดำเนินการไปแล้ว",
  claimMissing: "ไม่พบการยืนยันชื่อนี้",
} as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function positiveId(v: unknown): string | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
}

/** Who tapped, as Telegram shows them: first and last name, else @username (flattened and escaped when shown). */
function tapperName(from: Record<string, unknown>): string {
  const parts = [from.first_name, from.last_name].filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (parts.length) return parts.join(" ").slice(0, 100);
  return typeof from.username === "string" && from.username ? `@${from.username.slice(0, 64)}` : "";
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
 * retries anything else): only callback_query taps by an id in TELEGRAM_CHAT_ID change anything: the approve and
 * reject buttons of access requests ("ox:") and the undo button of claimed names ("oc:", undoTap()). Each is a single
 * conditional UPDATE, so a second tap or a redelivered update changes nothing.
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
  const claimTap = parseClaimCallbackData(cq.data);
  if (claimTap) {
    return undoTap(claimTap.claimId, by, tapperName(cq.from as Record<string, unknown>), cq.message, queryId, reply, defer);
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
  if (approved) noteAuthorized(r.phone);
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

/**
 * "↩️ ยกเลิกการยืนยัน" on a claim message, by an id in TELEGRAM_CHAT_ID (checked by the caller): ends the claim (lib/user-list.ts
 * undoClaim(): one conditional UPDATE of user_claims, undo_reason 'admin'; users is never written), frees the name, deletes
 * the number's LINE bindings and drops it from this instance's authorization cache (other instances within 60 s), so
 * the person's session stops working and signing in again needs LINE and an SMS code; they cannot claim again for 24 h
 * (an access request stays possible). Each claim message is edited to say who undid it, without the button. A number
 * that stays authorized another way (ALLOWED_PHONES, an approved access request) is not signed out, and the answer
 * says so. A second tap, or a tap on a claim that already ended (undone, released by hand, or closed by a newer claim of
 * the same person), changes nothing.
 */
async function undoTap(
  claimId: string,
  by: string,
  byName: string,
  message: unknown,
  queryId: string,
  reply: (text: string) => void,
  defer: Defer,
): Promise<WebhookReply> {
  let pool: Pool;
  let result: UndoResult;
  try {
    pool = await db();
    result = await undoClaim(pool, claimId, by);
  } catch (e) {
    console.error("[claim] undo failed:", (e as Error).message);
    reply(ANSWERS.failed);
    return OK;
  }
  if (result.outcome === "missing") {
    reply(ANSWERS.claimMissing);
    return OK;
  }
  if (result.outcome === "already") {
    reply(ANSWERS.claimAlready);
    return OK;
  }
  const { claim, user } = result;
  noteRevoked(claim.phone);
  await logEvent(pool, { event: "claim_undone", sub: claim.lineSub, phone: claim.phone });
  // The person is signed out only if nothing else authorizes the number; say so when something does.
  const stillAllowed = isAllowedPhone(claim.phone) || (await isApproved(pool, claim.phone).catch(() => false));
  const refs = [...claim.tgMessages];
  const tapped = tappedMessage(message);
  if (tapped && !refs.some((x) => x.chat_id === tapped.chat_id && x.message_id === tapped.message_id)) refs.push(tapped);
  const html = buildClaimUndoneMessage(user, claim, byName || by, claim.undoneAt ?? new Date());
  defer(async () => {
    await answerCallback(queryId, stillAllowed ? ANSWERS.claimUndoneStillAllowed : ANSWERS.claimUndone);
    await markDecided(refs, html);
  });
  return OK;
}
