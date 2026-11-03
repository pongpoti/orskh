import "server-only";
import { toInternational } from "../phone";
import { fetchFailure, int, isObject, isTimeout, TIMEOUT_MS, type CallOptions } from "./net";

/**
 * Twilio Verify (https://www.twilio.com/docs/verify/api): Twilio makes the code, sends it by SMS and checks it.
 * POST {base}/Services/{VA…}/Verifications (form: To=+66812345678, Channel=sms, Locale=th)
 *   -> 201 {sid: "VE…", status: "pending", …}
 * POST {base}/Services/{VA…}/VerificationCheck (form: VerificationSid=VE…, Code=123456)
 *   -> 200 {status: "approved" | "pending" (a wrong code) | …}
 * Errors: an HTTP 4xx/5xx with {code, message, more_info, status}. HTTP Basic auth with the Account SID and Auth Token.
 * A verification lives 10 minutes and is deleted once approved, expired or out of check attempts (a check then gets
 * 404 / 20404). The SMS text is the Verify Service's template, always in Thai (Locale=th; Twilio's default template
 * has a Thai translation); the code length is the service's (6, the default, is what the sign-in form takes).
 *
 * A refused request (HTTP 4xx) created nothing, so no SMS went out. A failed request is "uncertain" whenever Twilio
 * may have sent (and billed) the SMS: a timeout or a dropped connection after the request left, a 5xx, an answer that
 * is not JSON, or a success without a usable verification SID. lib/otp.ts keeps the reservation of an uncertain send.
 *
 * Never logged: the Auth Token, the verification SID, the code, the number. Only Twilio's error code is logged.
 */

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** The Verify Service SID (VA…). */
  serviceSid: string;
  /** Base URL without a trailing slash, e.g. https://verify.twilio.com/v2 */
  apiUrl: string;
}

/** The SMS is in Thai, whatever the number's country. */
export const SMS_LOCALE = "th";

/** A verification SID: VE and 32 hex digits. */
const VERIFICATION_SID = /^VE[0-9a-fA-F]{32}$/;

/** Twilio refuses the number itself: not a valid number (60200, 21211), a landline (60205), not a mobile (21614). */
const INVALID_NUMBER_CODES = new Set([60200, 60205, 21211, 21614]);

/**
 * Twilio refuses our settings or our account: wrong Account SID or Auth Token (20003), no such Verify Service (20404
 * when starting), SMS turned off for the service (60223), Thailand not allowed in Verify Geo permissions (60605),
 * blocked by Fraud Guard or by Twilio (60410, 60238), a trial account sending to a number it has not verified (21608).
 */
export const TWILIO_MISCONFIGURED_CODES = new Set([20003, 20404, 60223, 60605, 60410, 60238, 21608]);

/** The account is suspended, usually because the balance reached $0 (20005). */
const NO_CREDIT_CODES = new Set([20005]);

/** A check of a verification that is gone (approved, expired, cancelled) or out of check attempts. */
const CHECK_GONE_CODES = new Set([20404, 60202, 60431, 60623]);

export type StartOutcome =
  | { ok: true; sid: string }
  /** failed: certainly not sent. uncertain: Twilio may have sent (and billed) the SMS. */
  | { ok: false; reason: "invalid_number" | "misconfigured" | "no_credit" | "failed" | "uncertain"; code: number | null };

export type CheckOutcome =
  | { ok: true }
  | { ok: false; reason: "wrong" | "expired" | "misconfigured" | "failed"; code: number | null };

type Answer = { status: number; data: Record<string, unknown> } | { problem: string; notSent: boolean };

async function post(cfg: TwilioConfig, path: string, form: Record<string, string>, opts: CallOptions): Promise<Answer> {
  const f = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${cfg.apiUrl}/Services/${encodeURIComponent(cfg.serviceSid)}${path}`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`, "utf8").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(form).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (e) {
    return fetchFailure(e);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    return { problem: isTimeout(e) ? "timeout" : `HTTP ${res.status}, not JSON`, notSent: false };
  }
  return isObject(data) ? { status: res.status, data } : { problem: `HTTP ${res.status}, unexpected JSON`, notSent: false };
}

function logFailed(what: string, detail: string): void {
  console.error(`[sms] Twilio ${what} failed: ${detail}`);
}

/** Twilio's error code of a refused request (a number in `code`), else null. */
function errorCode(data: Record<string, unknown>): number | null {
  return int(data.code);
}

/** Asks Twilio Verify to send a code to `phone` (canonical 0812345678). */
export async function startVerification(cfg: TwilioConfig, phone: string, opts: CallOptions = {}): Promise<StartOutcome> {
  const r = await post(cfg, "/Verifications", { To: `+${toInternational(phone)}`, Channel: "sms", Locale: SMS_LOCALE }, opts);
  if ("problem" in r) {
    logFailed("verification", r.problem);
    return { ok: false, reason: r.notSent ? "failed" : "uncertain", code: null };
  }
  if (r.status >= 200 && r.status < 300) {
    // Accepted: the SMS is on its way. Without a usable SID the code cannot be checked, but it was still sent.
    const sid = typeof r.data.sid === "string" ? r.data.sid.trim() : "";
    if (VERIFICATION_SID.test(sid)) return { ok: true, sid };
    logFailed("verification", `HTTP ${r.status} without a usable verification SID`);
    return { ok: false, reason: "uncertain", code: null };
  }
  const code = errorCode(r.data);
  logFailed("verification", `HTTP ${r.status}, code ${code ?? "missing"}`);
  if (code !== null && INVALID_NUMBER_CODES.has(code)) return { ok: false, reason: "invalid_number", code };
  if (code !== null && NO_CREDIT_CODES.has(code)) return { ok: false, reason: "no_credit", code };
  if ((code !== null && TWILIO_MISCONFIGURED_CODES.has(code)) || r.status === 401 || r.status === 403 || r.status === 404) {
    return { ok: false, reason: "misconfigured", code };
  }
  // Any other refusal (rate limits such as 60203 or 20429, a bad parameter) created no verification: nothing was sent.
  if (r.status >= 400 && r.status < 500) return { ok: false, reason: "failed", code };
  return { ok: false, reason: "uncertain", code };
}

/** Asks Twilio Verify whether `code` is the one sent with verification `sid`. */
export async function checkVerification(cfg: TwilioConfig, sid: string, code: string, opts: CallOptions = {}): Promise<CheckOutcome> {
  if (!VERIFICATION_SID.test(sid)) return { ok: false, reason: "expired", code: null };
  const r = await post(cfg, "/VerificationCheck", { VerificationSid: sid, Code: code }, opts);
  if ("problem" in r) {
    logFailed("check", r.problem);
    return { ok: false, reason: "failed", code: null };
  }
  if (r.status >= 200 && r.status < 300) {
    const status = r.data.status;
    if (status === "approved") return { ok: true };
    // A wrong code is an ordinary event (the attempt is counted): not logged as a failure.
    if (status === "pending") return { ok: false, reason: "wrong", code: null };
    if (status === "canceled" || status === "expired" || status === "max_attempts_reached" || status === "deleted") {
      return { ok: false, reason: "expired", code: null };
    }
    logFailed("check", `HTTP ${r.status}, unexpected status`);
    return { ok: false, reason: "failed", code: null };
  }
  const errCode = errorCode(r.data);
  if ((errCode !== null && CHECK_GONE_CODES.has(errCode)) || r.status === 404) return { ok: false, reason: "expired", code: errCode };
  logFailed("check", `HTTP ${r.status}, code ${errCode ?? "missing"}`);
  if ((errCode !== null && (TWILIO_MISCONFIGURED_CODES.has(errCode) || NO_CREDIT_CODES.has(errCode))) || r.status === 401 || r.status === 403) {
    return { ok: false, reason: "misconfigured", code: errCode };
  }
  return { ok: false, reason: "failed", code: errCode };
}
