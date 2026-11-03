import "server-only";

/** What the SMS providers (deeSMSX, Twilio Verify) share: call options and how a failed fetch is read. */

export interface CallOptions {
  /** Tests only: a fetch stand-in. */
  fetch?: typeof fetch;
  /** Tests only: shorter than the 10 s default. */
  timeoutMs?: number;
}

export const TIMEOUT_MS = 10_000;

/**
 * Error codes (Node's fetch: TypeError("fetch failed") with `cause.code`) raised before the request could reach the
 * provider: the SMS certainly did not go out.
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

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A whole number given as a number or a string of digits; anything else is null. */
export function int(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v)) return v;
  if (typeof v === "string" && /^\s*-?\d{1,9}\s*$/.test(v)) return Number(v);
  return null;
}

/** The low-level error code of a failed fetch (e.cause.code, or e.code), if any. */
function causeCode(e: unknown): string | null {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = err?.cause?.code ?? err?.code;
  return typeof c === "string" ? c : null;
}

export function isTimeout(e: unknown): boolean {
  const name = (e as Error)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * A fetch that threw, described by the error's name and low-level code only (messages can carry request details).
 * `notSent`: the request certainly never reached the provider.
 */
export function fetchFailure(e: unknown): { problem: string; notSent: boolean } {
  if (isTimeout(e)) return { problem: "timeout", notSent: false };
  const name = (e as Error)?.name;
  const code = causeCode(e);
  const notSent = code !== null && NOT_SENT_CAUSES.has(code);
  return { problem: `network (${name ?? "error"}${code && /^[A-Z0-9_]{1,40}$/.test(code) ? ` ${code}` : ""})`, notSent };
}
