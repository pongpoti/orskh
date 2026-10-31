import "server-only";
import { toInternational } from "../phone";

/**
 * deeSMSX (https://deesmsx.com) OTP API: the provider makes the code, sends it by SMS and checks it.
 * POST {base}/otp/request {apiKey, secretKey, sender, to: "66812345678", lang, isShowRef}
 *   -> {error: "0", msg, status: "200", credit_balance: 10, result: {requestNo, token, ref}}
 * POST {base}/otp/verify {apiKey, secretKey, token, pin} -> {status: "0", error: "0", msg: "Verify Success", result: {}}
 * Errors carry the reference code as `error` (verify, and request success) or `code` (the request error example),
 * as a string in the examples; both fields and both types are accepted. Reference codes:
 * https://deesmsx.readme.io/reference/refenece-code
 *
 * A failed request is "uncertain" whenever deeSMSX may already have sent (and billed) the SMS: a timeout or a dropped
 * connection after the request left, an answer that is not JSON (a gateway's HTML 502/504), reference code 101
 * ("Unsuccess") or an unknown code, or a success whose token cannot be used. Only the documented refusals
 * (9, 99, 100, 102, 204) and errors raised before anything was sent (no DNS answer, connection refused) are certain.
 * lib/otp.ts keeps the reservation of an uncertain send, so it still counts for every limit and SMS_DAILY_CAP.
 *
 * Never logged: apiKey, secretKey, token, pin. Only the reference code is logged.
 */

export interface DeesmsxConfig {
  apiKey: string;
  secretKey: string;
  sender: string;
  /** Base URL without a trailing slash, e.g. https://apicall.deesmsx.com/v1 */
  apiUrl: string;
}

export interface CallOptions {
  /** Tests only: a fetch stand-in. */
  fetch?: typeof fetch;
  /** Tests only: shorter than the 10 s default. */
  timeoutMs?: number;
}

export const TIMEOUT_MS = 10_000;

/** Reference codes that mean our settings are wrong (key or secret, sender name, OTP template). */
export const MISCONFIGURED_CODES = new Set([9, 100, 204]);

/** Longest provider token kept (the documented one has 65 characters). */
export const TOKEN_MAX = 2048;

/**
 * Error codes (Node's fetch: TypeError("fetch failed") with `cause.code`) raised before the request could reach
 * deeSMSX: the SMS certainly did not go out.
 */
const NOT_SENT_CAUSES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "ERR_INVALID_URL",
]);

export type RequestOutcome =
  | { ok: true; token: string; ref: string; creditBalance: number | null }
  /** failed: certainly not sent. uncertain: deeSMSX may have sent (and billed) the SMS. */
  | { ok: false; reason: "invalid_number" | "misconfigured" | "no_credit" | "failed" | "uncertain"; code: number | null };

export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: "wrong" | "expired" | "misconfigured" | "failed"; code: number | null };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A whole number given as a number or a string of digits; anything else is null. */
function int(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v)) return v;
  if (typeof v === "string" && /^\s*-?\d{1,9}\s*$/.test(v)) return Number(v);
  return null;
}

/** The reference code of a response: `error` when it holds a number, else `code`. */
export function referenceCode(data: Record<string, unknown>): number | null {
  return int(data.error) ?? int(data.code);
}

/** credit_balance as a number (it may come as a number or a numeric string), else null. */
export function creditBalance(data: Record<string, unknown>): number | null {
  const v = data.credit_balance;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

/**
 * The reference to show beside the code: printable ASCII only, single spaces, at most 16 characters. The format is not
 * documented (the docs show "9N14"), so an unexpected ref is cleaned rather than turning a delivered SMS into a
 * failure; "" when nothing printable is left (the screen then shows no reference).
 */
export function cleanRef(v: unknown): string {
  const s = typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  return s
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, 16)
    .trim();
}

/** `notSent`: the request certainly never reached deeSMSX. */
type Post = { data: Record<string, unknown> } | { problem: string; notSent: boolean };

/** The low-level error code of a failed fetch (e.cause.code, or e.code), if any. */
function causeCode(e: unknown): string | null {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = err?.cause?.code ?? err?.code;
  return typeof c === "string" ? c : null;
}

async function post(cfg: DeesmsxConfig, path: string, body: Record<string, string>, opts: CallOptions): Promise<Post> {
  const f = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${cfg.apiUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (e) {
    // The error's name and low-level code only: messages can carry request details.
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") return { problem: "timeout", notSent: false };
    const code = causeCode(e);
    const notSent = code !== null && NOT_SENT_CAUSES.has(code);
    return { problem: `network (${name ?? "error"}${code && /^[A-Z0-9_]{1,40}$/.test(code) ? ` ${code}` : ""})`, notSent };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    const name = (e as Error)?.name;
    return { problem: name === "TimeoutError" || name === "AbortError" ? "timeout" : `HTTP ${res.status}, not JSON`, notSent: false };
  }
  return isObject(data) ? { data } : { problem: `HTTP ${res.status}, unexpected JSON`, notSent: false };
}

function logRefused(what: string, code: number | null, problem?: string): void {
  console.error(`[sms] deeSMSX ${what} failed: ${problem ?? `code ${code ?? "missing"}`}`);
}

/** Asks deeSMSX to send a code to `phone` (canonical 0812345678). */
export async function requestOtp(cfg: DeesmsxConfig, phone: string, opts: CallOptions = {}): Promise<RequestOutcome> {
  const r = await post(
    cfg,
    "/otp/request",
    {
      apiKey: cfg.apiKey,
      secretKey: cfg.secretKey,
      sender: cfg.sender,
      to: toInternational(phone),
      lang: "th",
      isShowRef: "1",
    },
    opts,
  );
  if ("problem" in r) {
    logRefused("OTP request", null, r.problem);
    return { ok: false, reason: r.notSent ? "failed" : "uncertain", code: null };
  }
  const code = referenceCode(r.data);
  if (code === 0) {
    // Accepted: the SMS is on its way. Without a usable token the code cannot be checked, but it was still sent.
    const result = isObject(r.data.result) ? r.data.result : {};
    const token = typeof result.token === "string" ? result.token.trim() : "";
    if (token && token.length <= TOKEN_MAX) {
      return { ok: true, token, ref: cleanRef(result.ref), creditBalance: creditBalance(r.data) };
    }
    logRefused("OTP request", code, "success without a usable token");
    return { ok: false, reason: "uncertain", code };
  }
  logRefused("OTP request", code);
  if (code === 99) return { ok: false, reason: "invalid_number", code };
  if (code !== null && MISCONFIGURED_CODES.has(code)) return { ok: false, reason: "misconfigured", code };
  if (code === 102) return { ok: false, reason: "no_credit", code };
  // 101 ("Unsuccess"), an unknown code or none: deeSMSX does not say whether the SMS went out.
  return { ok: false, reason: "uncertain", code };
}

/** Asks deeSMSX whether `pin` is the code sent with `token`. */
export async function verifyOtp(cfg: DeesmsxConfig, token: string, pin: string, opts: CallOptions = {}): Promise<VerifyOutcome> {
  const r = await post(cfg, "/otp/verify", { apiKey: cfg.apiKey, secretKey: cfg.secretKey, token, pin }, opts);
  if ("problem" in r) {
    logRefused("OTP verify", null, r.problem);
    return { ok: false, reason: "failed", code: null };
  }
  const code = referenceCode(r.data);
  if (code === 0) return { ok: true };
  // A wrong code is an ordinary event (the attempt is counted): not logged as a failure.
  if (code === 203) return { ok: false, reason: "wrong", code };
  if (code === 201 || code === 202) return { ok: false, reason: "expired", code };
  logRefused("OTP verify", code);
  if (code !== null && MISCONFIGURED_CODES.has(code)) return { ok: false, reason: "misconfigured", code };
  return { ok: false, reason: "failed", code };
}
