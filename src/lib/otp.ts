import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withTx } from "./db";

type Q = Pool | PoolClient;

export const CODE_TTL_MIN = 5;
export const MAX_ATTEMPTS = 5;
export const LIMITS = {
  perPhone15m: 3,
  /**
   * Codes to one number for one LINE account per 24 h (no SMS-bombing a phone). Counted per pair, so someone else's
   * requests can never block a physician's own sign-in for a day.
   */
  perPairDay: 6,
  perSubHour: 5,
  /** Different numbers one LINE account may ask codes for per 24 h (no texting arbitrary numbers; room for typos). */
  phonesPerSubDay: 5,
  perIpHour: 20,
  cooldownS: 60,
} as const;
export const BINDING_MAX_AGE_DAYS = 180;

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** HMAC-SHA256(OTP_PEPPER, phone|sub|code), hex. Local mode stores only this. */
export function hashCode(pepper: string, phone: string, sub: string, code: string): string {
  return createHmac("sha256", pepper).update(`${phone}|${sub}|${code}`, "utf8").digest("hex");
}

export function codeMatches(pepper: string, phone: string, sub: string, code: string, storedHex: string): boolean {
  const a = Buffer.from(hashCode(pepper, phone, sub, code), "hex");
  const b = Buffer.from(storedHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What the SMS side keeps for a code: an HMAC of it (local mode) or the provider's sealed token (deeSMSX). */
export interface StoredCode {
  codeHash: string | null;
  providerToken: string | null;
}

/**
 * Why a code was not sent. "failed" and the refusals are certain: no SMS went out. "uncertain": the provider may have
 * sent (and billed) the SMS although the code cannot be used (a timeout, an unreadable answer, an unknown result).
 */
export type SmsFailure = "invalid_number" | "misconfigured" | "no_credit" | "failed" | "uncertain";

export type IssueResult =
  | { ok: true; ref: string; stored: StoredCode; creditBalance: number | null }
  | { ok: false; reason: SmsFailure; providerCode: number | null };

export type CheckResult =
  | { ok: true }
  | { ok: false; reason: "wrong" | "expired" | "misconfigured" | "failed"; providerCode: number | null };

/** Sends and checks codes: deeSMSX, or the local console/file modes (lib/sms). */
export interface OtpTransport {
  issue(args: { phone: string; sub: string; pepper: string }): Promise<IssueResult>;
  check(args: { phone: string; sub: string; pepper: string; code: string; stored: StoredCode }): Promise<CheckResult>;
}

export type LimitReason = "cooldown" | "phone" | "pair_day" | "sub" | "sub_phones" | "ip";

export type ReserveResult =
  | { status: "reserved"; id: string; sentToday: number }
  | { status: "limited"; reason: LimitReason; retryAfterS: number }
  /** SMS_DAILY_CAP codes went out in the last 24 h (all numbers together): nothing is sent. */
  | { status: "capped"; sentToday: number; retryAfterS: number };

const DAY_S = 24 * 3600;

/** Seconds until a row created `ageS` seconds ago leaves the 24 h window (at least a minute). */
function untilDayWindow(ageS: number | null): number {
  return Math.max(60, Math.ceil(DAY_S - (ageS ?? 0)));
}

/**
 * Checks the rate limits and the global daily cap, then reserves a row for phone+sub (it cannot be verified yet:
 * expires_at = now). The reservation counts for every limit while the SMS is being sent, so two quick requests
 * never both send. All reservations are serialized by one advisory lock (held for a few queries, never while the
 * provider is called), which makes SMS_DAILY_CAP exact. Every valid number is treated alike: the limits never depend
 * on whether it is on the list.
 */
export async function reserveCode(
  pool: Pool,
  args: { phone: string; sub: string; ip: string; dailyCap: number },
): Promise<ReserveResult> {
  const { phone, sub, ip, dailyCap } = args;
  return withTx(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('otp-send'))");
    const { rows } = await c.query<{
      phone_15m: number;
      pair_24h: number;
      pair_oldest_s: number | null;
      sub_1h: number;
      sub_phones_24h: number;
      sub_knows_phone: boolean | null;
      sub_oldest_s: number | null;
      ip_1h: number;
      pair_age_s: number | null;
    }>(
      `SELECT
         count(*) FILTER (WHERE phone = $1 AND created_at > now() - interval '15 minutes')::int AS phone_15m,
         count(*) FILTER (WHERE phone = $1 AND line_sub = $2)::int AS pair_24h,
         extract(epoch FROM now() - min(created_at) FILTER (WHERE phone = $1 AND line_sub = $2))::float8 AS pair_oldest_s,
         count(*) FILTER (WHERE line_sub = $2 AND created_at > now() - interval '1 hour')::int AS sub_1h,
         count(DISTINCT phone) FILTER (WHERE line_sub = $2)::int AS sub_phones_24h,
         bool_or(line_sub = $2 AND phone = $1) AS sub_knows_phone,
         extract(epoch FROM now() - min(created_at) FILTER (WHERE line_sub = $2))::float8 AS sub_oldest_s,
         count(*) FILTER (WHERE ip = $3 AND created_at > now() - interval '1 hour')::int AS ip_1h,
         extract(epoch FROM now() - max(created_at) FILTER (WHERE phone = $1 AND line_sub = $2))::float8 AS pair_age_s
       FROM otp_codes
       WHERE created_at > now() - interval '24 hours'
         AND (phone = $1 OR line_sub = $2 OR (ip = $3 AND created_at > now() - interval '1 hour'))`,
      [phone, sub, ip],
    );
    const r = rows[0];
    if (r.pair_age_s !== null && r.pair_age_s < LIMITS.cooldownS) {
      return { status: "limited", reason: "cooldown", retryAfterS: Math.max(1, Math.ceil(LIMITS.cooldownS - r.pair_age_s)) };
    }
    if (r.phone_15m >= LIMITS.perPhone15m) return { status: "limited", reason: "phone", retryAfterS: 15 * 60 };
    if (r.pair_24h >= LIMITS.perPairDay) {
      return { status: "limited", reason: "pair_day", retryAfterS: untilDayWindow(r.pair_oldest_s) };
    }
    if (r.sub_1h >= LIMITS.perSubHour) return { status: "limited", reason: "sub", retryAfterS: 3600 };
    // A new number once this LINE account already asked for LIMITS.phonesPerSubDay others (re-sends to those stay possible).
    if (!r.sub_knows_phone && r.sub_phones_24h >= LIMITS.phonesPerSubDay) {
      return { status: "limited", reason: "sub_phones", retryAfterS: untilDayWindow(r.sub_oldest_s) };
    }
    if (r.ip_1h >= LIMITS.perIpHour) return { status: "limited", reason: "ip", retryAfterS: 3600 };

    const total = await c.query<{ n: number; oldest_s: number | null }>(
      `SELECT count(*)::int AS n, extract(epoch FROM now() - min(created_at))::float8 AS oldest_s
       FROM otp_codes WHERE created_at > now() - interval '24 hours'`,
    );
    const sent = total.rows[0].n;
    if (sent >= dailyCap) return { status: "capped", sentToday: sent, retryAfterS: untilDayWindow(total.rows[0].oldest_s) };

    const ins = await c.query<{ id: string }>(
      "INSERT INTO otp_codes (phone, line_sub, expires_at, ip) VALUES ($1, $2, now(), $3) RETURNING id",
      [phone, sub, ip],
    );
    // Housekeeping: codes are useless after expiry; keep a week for rate-limit forensics.
    await c.query("DELETE FROM otp_codes WHERE created_at < now() - interval '7 days'");
    return { status: "reserved", id: String(ins.rows[0].id), sentToday: sent + 1 };
  });
}

/** The SMS went out: the reserved row becomes a live code for CODE_TTL_MIN, and older unused codes stop working. */
export async function completeCode(
  pool: Pool,
  args: { id: string; phone: string; sub: string; ref: string; stored: StoredCode },
): Promise<void> {
  const { id, phone, sub, ref, stored } = args;
  await withTx(pool, async (c) => {
    await c.query(
      "UPDATE otp_codes SET expires_at = now() WHERE phone = $1 AND line_sub = $2 AND used_at IS NULL AND expires_at > now() AND id <> $3",
      [phone, sub, id],
    );
    await c.query(
      `UPDATE otp_codes SET code_hash = $2, provider_token = $3, ref = $4, expires_at = now() + make_interval(mins => $5)
       WHERE id = $1`,
      [id, stored.codeHash, stored.providerToken, ref, CODE_TTL_MIN],
    );
  });
}

/**
 * Sending certainly failed (nothing went out): the reservation is removed, so the failure costs no quota (never touches
 * a completed row). Not used for an uncertain send, whose row stays as a reservation (expires_at = created_at, no code
 * stored): it can never be verified, but it counts for the cooldown, every limit and SMS_DAILY_CAP like a sent code.
 */
export async function releaseCode(pool: Q, id: string): Promise<void> {
  await pool.query("DELETE FROM otp_codes WHERE id = $1 AND code_hash IS NULL AND provider_token IS NULL", [id]);
}

export type SendResult =
  | { status: "sent"; ref: string; sentToday: number; creditBalance: number | null }
  | { status: "limited"; reason: LimitReason; retryAfterS: number }
  | { status: "capped"; sentToday: number; retryAfterS: number }
  | { status: "failed"; reason: SmsFailure; providerCode: number | null };

/**
 * Sends a code to phone for this LINE account: limits and cap (reserveCode), then the SMS, then the row is completed.
 * When the SMS certainly did not go out the row is removed; when it may have (reason "uncertain", or the transport
 * threw) the row is kept, so a slow or failing provider can never be used to send SMS past the limits. Every valid
 * number gets a real code; whether it is authorized is decided after the code is verified (sign-in, or an access
 * request).
 */
export async function sendCode(
  pool: Pool,
  args: { phone: string; sub: string; ip: string; pepper: string; dailyCap: number; transport: OtpTransport },
): Promise<SendResult> {
  const { phone, sub, ip, pepper, dailyCap, transport } = args;
  const reserved = await reserveCode(pool, { phone, sub, ip, dailyCap });
  if (reserved.status !== "reserved") return reserved;
  let issued: IssueResult;
  try {
    issued = await transport.issue({ phone, sub, pepper });
  } catch (e) {
    // Nobody knows how far the transport got: treated as possibly sent.
    console.error("[otp] sending the SMS failed:", (e as Error).message);
    issued = { ok: false, reason: "uncertain", providerCode: null };
  }
  if (!issued.ok) {
    if (issued.reason !== "uncertain") await releaseCode(pool, reserved.id);
    return { status: "failed", reason: issued.reason, providerCode: issued.providerCode };
  }
  await completeCode(pool, { id: reserved.id, phone, sub, ref: issued.ref, stored: issued.stored });
  return { status: "sent", ref: issued.ref, sentToday: reserved.sentToday, creditBalance: issued.creditBalance };
}

/**
 * True when phone+sub has a code that can still be verified (unused, not expired, attempts left). Only this account's
 * own rows decide it.
 */
export async function hasLiveCode(pool: Q, phone: string, sub: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM otp_codes
     WHERE phone = $1 AND line_sub = $2 AND used_at IS NULL AND expires_at > now() AND attempts < $3 LIMIT 1`,
    [phone, sub, MAX_ATTEMPTS],
  );
  return rows.length > 0;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "invalid"; remaining: number }
  | { ok: false; reason: "locked" }
  | { ok: false; reason: "expired" }
  /** The provider could not be asked (or refused our settings); the attempt is given back. */
  | { ok: false; reason: "unavailable"; detail: "misconfigured" | "failed"; providerCode: number | null };

/**
 * Checks a code for phone+sub. The attempt is counted first with a single conditional UPDATE
 * (attempts < MAX_ATTEMPTS), so concurrent guesses can never exceed the limit; then the code is checked (locally or
 * by the provider). Success marks the code used atomically (single use).
 */
export async function verifyCode(
  pool: Q,
  args: { phone: string; sub: string; code: string; pepper: string; transport: OtpTransport },
): Promise<VerifyResult> {
  const { phone, sub, code, pepper, transport } = args;
  const { rows } = await pool.query<{ id: string; code_hash: string | null; provider_token: string | null; attempts: number }>(
    `UPDATE otp_codes o SET attempts = o.attempts + 1
     FROM (
       SELECT id FROM otp_codes
       WHERE phone = $1 AND line_sub = $2 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC, id DESC LIMIT 1
     ) t
     WHERE o.id = t.id AND o.attempts < $3 AND o.used_at IS NULL AND o.expires_at > now()
     RETURNING o.id, o.code_hash, o.provider_token, o.attempts`,
    [phone, sub, MAX_ATTEMPTS],
  );
  if (rows.length === 0) {
    const live = await pool.query<{ attempts: number }>(
      `SELECT attempts FROM otp_codes
       WHERE phone = $1 AND line_sub = $2 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [phone, sub],
    );
    return live.rows.length && live.rows[0].attempts >= MAX_ATTEMPTS
      ? { ok: false, reason: "locked" }
      : { ok: false, reason: "expired" };
  }
  const row = rows[0];
  let checked: CheckResult;
  if (!/^\d{6}$/.test(code)) {
    checked = { ok: false, reason: "wrong", providerCode: null };
  } else {
    try {
      checked = await transport.check({
        phone,
        sub,
        pepper,
        code,
        stored: { codeHash: row.code_hash, providerToken: row.provider_token },
      });
    } catch (e) {
      console.error("[otp] checking the code failed:", (e as Error).message);
      checked = { ok: false, reason: "failed", providerCode: null };
    }
  }
  if (checked.ok) {
    const used = await pool.query("UPDATE otp_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id", [
      row.id,
    ]);
    if (used.rowCount === 1) return { ok: true };
    return { ok: false, reason: "expired" };
  }
  if (checked.reason === "expired") {
    // The provider says the code is used or expired: so is our row.
    await pool.query("UPDATE otp_codes SET expires_at = now() WHERE id = $1 AND used_at IS NULL", [row.id]);
    return { ok: false, reason: "expired" };
  }
  if (checked.reason === "misconfigured" || checked.reason === "failed") {
    await pool.query("UPDATE otp_codes SET attempts = attempts - 1 WHERE id = $1 AND attempts > 0", [row.id]);
    return { ok: false, reason: "unavailable", detail: checked.reason, providerCode: checked.providerCode };
  }
  const remaining = Math.max(0, MAX_ATTEMPTS - row.attempts);
  return remaining === 0 ? { ok: false, reason: "locked" } : { ok: false, reason: "invalid", remaining };
}

export interface Binding {
  phone: string;
  verifiedAt: Date;
}

/** Binding for a LINE account if it was verified within BINDING_MAX_AGE_DAYS. */
export async function findFreshBinding(pool: Q, sub: string): Promise<Binding | null> {
  const { rows } = await pool.query<{ phone: string; verified_at: Date }>(
    `SELECT phone, verified_at FROM line_bindings
     WHERE line_sub = $1 AND verified_at > now() - make_interval(days => $2)`,
    [sub, BINDING_MAX_AGE_DAYS],
  );
  return rows.length ? { phone: rows[0].phone, verifiedAt: rows[0].verified_at } : null;
}

export async function upsertBinding(pool: Q, sub: string, phone: string, displayName: string): Promise<void> {
  await pool.query(
    `INSERT INTO line_bindings (line_sub, phone, display_name, verified_at, last_login_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (line_sub) DO UPDATE
       SET phone = EXCLUDED.phone, display_name = EXCLUDED.display_name,
           verified_at = now(), last_login_at = now()`,
    [sub, phone, displayName.slice(0, 200)],
  );
}

export interface OtpHistory {
  /** Most recent earlier code verification of this number by any LINE account, or null. */
  phone: Date | null;
  /** Most recent earlier code verification of this number by this LINE account, or null. */
  account: Date | null;
}

/** Earlier successful code verifications (audit log). Call before logging the current one. */
export async function otpHistory(pool: Q, phone: string, sub: string): Promise<OtpHistory> {
  const { rows } = await pool.query<{ phone_at: Date | null; account_at: Date | null }>(
    `SELECT max(at) AS phone_at, max(at) FILTER (WHERE line_sub = $2) AS account_at
     FROM login_events WHERE phone = $1 AND event = 'login_otp'`,
    [phone, sub],
  );
  return { phone: rows[0]?.phone_at ?? null, account: rows[0]?.account_at ?? null };
}

/** Distinct numbers that have ever verified with a code. */
export async function countOtpPhones(pool: Q): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(DISTINCT phone)::int AS n FROM login_events WHERE event = 'login_otp'",
  );
  return rows[0]?.n ?? 0;
}

export async function touchBinding(pool: Q, sub: string, displayName: string): Promise<void> {
  await pool.query("UPDATE line_bindings SET last_login_at = now(), display_name = $2 WHERE line_sub = $1", [
    sub,
    displayName.slice(0, 200),
  ]);
}

export type LoginEvent =
  | "login_binding"
  | "login_otp"
  | "login_access"
  | "otp_sent"
  | "otp_send_failed"
  | "otp_send_uncertain"
  | "otp_rate_limited"
  | "otp_daily_cap"
  | "otp_failed"
  | "otp_locked"
  | "otp_verified_unlisted"
  | "access_requested"
  | "access_request_limited"
  | "access_approved"
  | "access_rejected"
  | "logout";

export interface EventRow {
  event: LoginEvent;
  sub?: string | null;
  phone?: string | null;
  ip?: string;
  userAgent?: string;
}

/** Audit log row that must be written: throws when it cannot be. */
export async function insertEvent(pool: Q, e: EventRow): Promise<void> {
  await pool.query(
    "INSERT INTO login_events (line_sub, phone, event, ip, user_agent) VALUES ($1, $2, $3, $4, $5)",
    [e.sub ?? null, e.phone ?? null, e.event, e.ip ?? null, e.userAgent ?? null],
  );
}

/** Audit log. Never pass codes or tokens here. Failures are logged, not thrown. */
export async function logEvent(pool: Q, e: EventRow): Promise<void> {
  try {
    await insertEvent(pool, e);
  } catch (err) {
    console.error("[auth] could not write login event:", (err as Error).message);
  }
}
