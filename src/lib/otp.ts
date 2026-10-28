import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withTx } from "./db";

type Q = Pool | PoolClient;

export const CODE_TTL_MIN = 10;
export const MAX_ATTEMPTS = 5;
export const LIMITS = {
  perEmail15m: 3,
  /**
   * Codes to one address for one LINE account per 24 h (no mail-bombing an inbox). Counted per pair, so
   * someone else's requests can never block a physician's own sign-in for a day.
   */
  perPairDay: 6,
  perSubHour: 5,
  /** Different addresses one LINE account may ask codes for per 24 h (no mailing arbitrary addresses; room for typos). */
  emailsPerSubDay: 5,
  perIpHour: 20,
  cooldownS: 60,
} as const;
/**
 * Not a limit: when this many codes were sent in 24 h (all addresses), the administrators are alerted, because
 * the mail account's daily sending quota (about 500 for Gmail) is shared by every sign-in.
 */
export const VOLUME_ALERT_PER_DAY = 150;
export const BINDING_MAX_AGE_DAYS = 180;

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** HMAC-SHA256(OTP_PEPPER, email|sub|code), hex. Only this is stored. */
export function hashCode(pepper: string, email: string, sub: string, code: string): string {
  return createHmac("sha256", pepper).update(`${email}|${sub}|${code}`, "utf8").digest("hex");
}

export function codeMatches(pepper: string, email: string, sub: string, code: string, storedHex: string): boolean {
  const a = Buffer.from(hashCode(pepper, email, sub, code), "hex");
  const b = Buffer.from(storedHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type RequestResult =
  | { status: "issued"; code: string; sentToday: number }
  | {
      status: "limited";
      reason: "cooldown" | "email" | "pair_day" | "sub" | "sub_emails" | "ip";
      retryAfterS: number;
    };

const DAY_S = 24 * 3600;

/** Seconds until a row created `ageS` seconds ago leaves the 24 h window (at least a minute). */
function untilDayWindow(ageS: number | null): number {
  return Math.max(60, Math.ceil(DAY_S - (ageS ?? 0)));
}

/**
 * Creates a code for email+sub after DB-backed rate limits. Every valid address gets a real code:
 * proving ownership comes first; whether the email is authorized is decided after the code is verified
 * (sign-in, or an access request). The limits apply to every address alike, so a refusal says nothing about
 * the physician list. Returns the plaintext code to be emailed (only its HMAC is stored) and how many codes were
 * sent in the last 24 h in total, this one included (see VOLUME_ALERT_PER_DAY).
 */
export async function requestCode(
  pool: Pool,
  args: { email: string; sub: string; ip: string; pepper: string },
): Promise<RequestResult> {
  const { email, sub, ip, pepper } = args;
  return withTx(pool, async (c) => {
    // Serialize concurrent sends for the same LINE account and the same email.
    await c.query("SELECT pg_advisory_xact_lock(hashtext('otp-sub:' || $1))", [sub]);
    await c.query("SELECT pg_advisory_xact_lock(hashtext('otp-email:' || $1))", [email]);
    const { rows } = await c.query<{
      email_15m: number;
      pair_24h: number;
      pair_oldest_s: number | null;
      sub_1h: number;
      sub_emails_24h: number;
      sub_knows_email: boolean | null;
      sub_oldest_s: number | null;
      ip_1h: number;
      pair_age_s: number | null;
    }>(
      `SELECT
         count(*) FILTER (WHERE email = $1 AND created_at > now() - interval '15 minutes')::int AS email_15m,
         count(*) FILTER (WHERE email = $1 AND line_sub = $2)::int AS pair_24h,
         extract(epoch FROM now() - min(created_at) FILTER (WHERE email = $1 AND line_sub = $2))::float8 AS pair_oldest_s,
         count(*) FILTER (WHERE line_sub = $2 AND created_at > now() - interval '1 hour')::int AS sub_1h,
         count(DISTINCT email) FILTER (WHERE line_sub = $2)::int AS sub_emails_24h,
         bool_or(line_sub = $2 AND email = $1) AS sub_knows_email,
         extract(epoch FROM now() - min(created_at) FILTER (WHERE line_sub = $2))::float8 AS sub_oldest_s,
         count(*) FILTER (WHERE ip = $3 AND created_at > now() - interval '1 hour')::int AS ip_1h,
         extract(epoch FROM now() - max(created_at) FILTER (WHERE email = $1 AND line_sub = $2))::float8 AS pair_age_s
       FROM otp_codes
       WHERE created_at > now() - interval '24 hours'
         AND (email = $1 OR line_sub = $2 OR (ip = $3 AND created_at > now() - interval '1 hour'))`,
      [email, sub, ip],
    );
    const r = rows[0];
    if (r.pair_age_s !== null && r.pair_age_s < LIMITS.cooldownS) {
      return { status: "limited", reason: "cooldown", retryAfterS: Math.max(1, Math.ceil(LIMITS.cooldownS - r.pair_age_s)) };
    }
    if (r.email_15m >= LIMITS.perEmail15m) return { status: "limited", reason: "email", retryAfterS: 15 * 60 };
    if (r.pair_24h >= LIMITS.perPairDay) {
      return { status: "limited", reason: "pair_day", retryAfterS: untilDayWindow(r.pair_oldest_s) };
    }
    if (r.sub_1h >= LIMITS.perSubHour) return { status: "limited", reason: "sub", retryAfterS: 3600 };
    // A new address once this LINE account already asked for LIMITS.emailsPerSubDay others (re-sends to those stay possible).
    if (!r.sub_knows_email && r.sub_emails_24h >= LIMITS.emailsPerSubDay) {
      return { status: "limited", reason: "sub_emails", retryAfterS: untilDayWindow(r.sub_oldest_s) };
    }
    if (r.ip_1h >= LIMITS.perIpHour) return { status: "limited", reason: "ip", retryAfterS: 3600 };

    // Older unused codes for this email+sub stop working.
    await c.query(
      "UPDATE otp_codes SET expires_at = now() WHERE email = $1 AND line_sub = $2 AND used_at IS NULL AND expires_at > now()",
      [email, sub],
    );
    const code = generateCode();
    await c.query(
      `INSERT INTO otp_codes (email, line_sub, code_hash, expires_at, ip)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4), $5)`,
      [email, sub, hashCode(pepper, email, sub, code), CODE_TTL_MIN, ip],
    );
    // Housekeeping: codes are useless after expiry; keep a week for rate-limit forensics.
    await c.query("DELETE FROM otp_codes WHERE created_at < now() - interval '7 days'");
    const total = await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM otp_codes WHERE created_at > now() - interval '24 hours'",
    );
    return { status: "issued", code, sentToday: total.rows[0].n };
  });
}

let lastVolumeAlert = -Infinity;
const VOLUME_ALERT_EVERY_MS = 6 * 3600 * 1000;

/**
 * True when `sentToday` reached VOLUME_ALERT_PER_DAY and this instance has not alerted in the last 6 hours
 * (so a sustained flood gives a few alerts, not one per code).
 */
export function volumeAlertDue(sentToday: number, now = Date.now()): boolean {
  if (sentToday < VOLUME_ALERT_PER_DAY || now - lastVolumeAlert < VOLUME_ALERT_EVERY_MS) return false;
  lastVolumeAlert = now;
  return true;
}

/** Tests only. */
export function resetVolumeAlert(): void {
  lastVolumeAlert = -Infinity;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "invalid"; remaining: number }
  | { ok: false; reason: "locked" }
  | { ok: false; reason: "expired" };

/**
 * Checks a code for email+sub. Attempts are counted with a single conditional UPDATE
 * (attempts < MAX_ATTEMPTS), so concurrent guesses can never exceed the limit.
 * Success marks the code used atomically (single use).
 */
export async function verifyCode(
  pool: Q,
  args: { email: string; sub: string; code: string; pepper: string },
): Promise<VerifyResult> {
  const { email, sub, code, pepper } = args;
  const { rows } = await pool.query<{ id: string; code_hash: string; attempts: number }>(
    `UPDATE otp_codes o SET attempts = o.attempts + 1
     FROM (
       SELECT id FROM otp_codes
       WHERE email = $1 AND line_sub = $2 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC, id DESC LIMIT 1
     ) t
     WHERE o.id = t.id AND o.attempts < $3 AND o.used_at IS NULL AND o.expires_at > now()
     RETURNING o.id, o.code_hash, o.attempts`,
    [email, sub, MAX_ATTEMPTS],
  );
  if (rows.length === 0) {
    const live = await pool.query<{ attempts: number }>(
      `SELECT attempts FROM otp_codes
       WHERE email = $1 AND line_sub = $2 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [email, sub],
    );
    return live.rows.length && live.rows[0].attempts >= MAX_ATTEMPTS
      ? { ok: false, reason: "locked" }
      : { ok: false, reason: "expired" };
  }
  const row = rows[0];
  if (/^\d{6}$/.test(code) && codeMatches(pepper, email, sub, code, row.code_hash)) {
    const used = await pool.query(
      "UPDATE otp_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id",
      [row.id],
    );
    if (used.rowCount === 1) return { ok: true };
  }
  const remaining = Math.max(0, MAX_ATTEMPTS - row.attempts);
  return remaining === 0 ? { ok: false, reason: "locked" } : { ok: false, reason: "invalid", remaining };
}

export interface Binding {
  email: string;
  verifiedAt: Date;
}

/** Binding for a LINE account if it was verified within BINDING_MAX_AGE_DAYS. */
export async function findFreshBinding(pool: Q, sub: string): Promise<Binding | null> {
  const { rows } = await pool.query<{ email: string; verified_at: Date }>(
    `SELECT email, verified_at FROM line_bindings
     WHERE line_sub = $1 AND verified_at > now() - make_interval(days => $2)`,
    [sub, BINDING_MAX_AGE_DAYS],
  );
  return rows.length ? { email: rows[0].email, verifiedAt: rows[0].verified_at } : null;
}

export async function upsertBinding(pool: Q, sub: string, email: string, displayName: string): Promise<void> {
  await pool.query(
    `INSERT INTO line_bindings (line_sub, email, display_name, verified_at, last_login_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (line_sub) DO UPDATE
       SET email = EXCLUDED.email, display_name = EXCLUDED.display_name,
           verified_at = now(), last_login_at = now()`,
    [sub, email, displayName.slice(0, 200)],
  );
}

export interface OtpHistory {
  /** Most recent earlier code verification of this email by any LINE account, or null. */
  email: Date | null;
  /** Most recent earlier code verification of this email by this LINE account, or null. */
  account: Date | null;
}

/** Earlier successful code verifications (audit log). Call before logging the current one. */
export async function otpHistory(pool: Q, email: string, sub: string): Promise<OtpHistory> {
  const { rows } = await pool.query<{ email_at: Date | null; account_at: Date | null }>(
    `SELECT max(at) AS email_at, max(at) FILTER (WHERE line_sub = $2) AS account_at
     FROM login_events WHERE email = $1 AND event = 'login_otp'`,
    [email, sub],
  );
  return { email: rows[0]?.email_at ?? null, account: rows[0]?.account_at ?? null };
}

/** Distinct emails that have ever verified with a code. */
export async function countOtpEmails(pool: Q): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(DISTINCT email)::int AS n FROM login_events WHERE event = 'login_otp'",
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
  | "otp_rate_limited"
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
  email?: string | null;
  ip?: string;
  userAgent?: string;
}

/** Audit log row that must be written: throws when it cannot be. */
export async function insertEvent(pool: Q, e: EventRow): Promise<void> {
  await pool.query(
    "INSERT INTO login_events (line_sub, email, event, ip, user_agent) VALUES ($1, $2, $3, $4, $5)",
    [e.sub ?? null, e.email ?? null, e.event, e.ip ?? null, e.userAgent ?? null],
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
