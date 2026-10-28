import "server-only";
import { allowedEmailsRaw } from "./env";

// Pragmatic address check (ASCII local part + dotted DNS name), applied after normalization.
// scripts/physicians-roster.mjs repeats it (a unit test keeps the two identical).
export const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** NFKC + trim + lowercase. Returns null when the result is not a plausible address. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 320) return null;
  const v = input.normalize("NFKC").trim().toLowerCase();
  if (v.length < 3 || v.length > 254 || !EMAIL_RE.test(v)) return null;
  return v;
}

/** Parses a comma (or whitespace/semicolon) separated list into normalized addresses. */
export function parseAllowlist(raw: string): Set<string> {
  const out = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const e = normalizeEmail(part);
    if (e) out.add(e);
  }
  return out;
}

let memo: { raw: string; set: Set<string> } | null = null;

/** True when the (already normalized or raw) email is in the break-glass ALLOWED_EMAILS. False when it is unset. */
export function isAllowedEmail(email: string): boolean {
  const raw = allowedEmailsRaw();
  if (!raw) return false;
  if (!memo || memo.raw !== raw) memo = { raw, set: parseAllowlist(raw) };
  const e = normalizeEmail(email);
  return e !== null && memo.set.has(e);
}
