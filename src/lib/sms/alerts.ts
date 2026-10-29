import "server-only";
import type { SendResult, VerifyResult } from "../otp";
import { buildCapAlert, buildLowCreditAlert, buildSmsProblemAlert, buildVolumeAlert } from "../telegram";

/**
 * Telegram alerts about sending codes, each kind at most once per interval per server instance (a sustained problem
 * gives a few alerts, not one per sign-in):
 * - misconfigured: deeSMSX refused our settings (reference code 9, 100 or 204): nobody can get a code;
 * - no_credit: deeSMSX says the credit is used up (102);
 * - cap: SMS_DAILY_CAP codes were sent in 24 h, sending has stopped;
 * - low_credit: the balance deeSMSX reports fell below LOW_CREDIT_BELOW;
 * - volume: half the daily cap was used (unusually many codes);
 * - uncertain: UNCERTAIN_ALERT_AFTER sends within UNCERTAIN_WINDOW_MS ended without knowing whether deeSMSX sent the
 *   SMS (timeouts, unreadable answers): users get errors while credit may still be spent.
 */
export const ALERT_EVERY_MS = {
  misconfigured: 3600_000,
  uncertain: 3600_000,
  no_credit: 3600_000,
  cap: 3600_000,
  low_credit: 6 * 3600_000,
  volume: 6 * 3600_000,
} as const;
export type AlertKind = keyof typeof ALERT_EVERY_MS;

export const LOW_CREDIT_BELOW = 100;

export const UNCERTAIN_ALERT_AFTER = 3;
export const UNCERTAIN_WINDOW_MS = 15 * 60_000;

const last = new Map<AlertKind, number>();
/** Times of recent uncertain sends on this instance (newest last). */
let uncertainAt: number[] = [];

/** True (and remembered) when an alert of this kind may go out now. */
export function alertDue(kind: AlertKind, now = Date.now()): boolean {
  const prev = last.get(kind);
  if (prev !== undefined && now - prev < ALERT_EVERY_MS[kind]) return false;
  last.set(kind, now);
  return true;
}

/** Tests only. */
export function resetSmsAlerts(): void {
  last.clear();
  uncertainAt = [];
}

/** The alert after half of SMS_DAILY_CAP is used. */
export function volumeThreshold(cap: number): number {
  return Math.max(1, Math.floor(cap / 2));
}

/** Telegram messages (HTML) that are due after sending a code. */
export function alertsAfterSend(r: SendResult, dailyCap: number, now = Date.now()): string[] {
  const at = new Date(now);
  const out: string[] = [];
  if (r.status === "capped") {
    if (alertDue("cap", now)) out.push(buildCapAlert(dailyCap, at));
  } else if (r.status === "failed") {
    if (r.reason === "misconfigured" && alertDue("misconfigured", now)) out.push(buildSmsProblemAlert("misconfigured", r.providerCode, at));
    if (r.reason === "no_credit" && alertDue("no_credit", now)) out.push(buildSmsProblemAlert("no_credit", r.providerCode, at));
    if (r.reason === "uncertain") {
      uncertainAt = [...uncertainAt.filter((t) => now - t < UNCERTAIN_WINDOW_MS), now];
      if (uncertainAt.length >= UNCERTAIN_ALERT_AFTER && alertDue("uncertain", now)) {
        out.push(buildSmsProblemAlert("uncertain", r.providerCode, at, uncertainAt.length));
      }
    }
  } else if (r.status === "sent") {
    if (r.creditBalance !== null && r.creditBalance < LOW_CREDIT_BELOW && alertDue("low_credit", now)) {
      out.push(buildLowCreditAlert(r.creditBalance, at));
    }
    if (r.sentToday >= volumeThreshold(dailyCap) && alertDue("volume", now)) out.push(buildVolumeAlert(r.sentToday, dailyCap, at));
  }
  return out;
}

/** Telegram messages (HTML) that are due after checking a code. */
export function alertsAfterVerify(r: VerifyResult, now = Date.now()): string[] {
  if (!r.ok && r.reason === "unavailable" && r.detail === "misconfigured" && alertDue("misconfigured", now)) {
    return [buildSmsProblemAlert("misconfigured", r.providerCode, new Date(now))];
  }
  return [];
}
