import "server-only";
import { allowedPhonesRaw } from "./env";

/**
 * Thai mobile numbers, the sign-in identity. Stored and compared in one canonical form, "0812345678": ten digits,
 * a leading 0, then 6, 8 or 9 (the mobile ranges). scripts/physicians-roster.mjs repeats PHONE_RE and normalizePhone()
 * (a unit test keeps the two identical).
 */
export const PHONE_RE = /^0[689]\d{8}$/;

/**
 * NFKC (full-width digits), Thai digits ๐-๙ to ASCII, spaces, dashes, dots and parentheses removed; accepts
 * 0XXXXXXXXX, 66XXXXXXXXX and +66XXXXXXXXX (also with the 0 kept: +660XXXXXXXXX, as on business cards). Returns the
 * canonical "0812345678", or null when it is not a Thai mobile number.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 40) return null;
  let v = input
    .normalize("NFKC")
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/[\s\-.()‐-―]/g, "");
  if (/^\+66\d{9}$/.test(v)) v = `0${v.slice(3)}`;
  else if (/^66\d{9}$/.test(v)) v = `0${v.slice(2)}`;
  // "+66 (0) 81 234 5678", "+66 081-234-5678": the country code written before the national number with its 0.
  else if (/^\+?660\d{9}$/.test(v)) v = v.replace(/^\+?66/, "");
  return PHONE_RE.test(v) ? v : null;
}

/** "0812345678" -> "66812345678", the format the SMS provider expects. */
export function toInternational(phone: string): string {
  return `66${phone.slice(1)}`;
}

/** "0812345678" -> "081-234-5678" for display. Anything else is returned unchanged. */
export function formatPhone(phone: string): string {
  return PHONE_RE.test(phone) ? `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}` : phone;
}

/**
 * Parses a comma, semicolon or newline separated list into canonical numbers (spaces and dashes inside a number are
 * fine). Invalid entries are dropped.
 */
export function parsePhoneList(raw: string): Set<string> {
  const out = new Set<string>();
  for (const part of raw.split(/[,;\n]+/)) {
    const p = normalizePhone(part);
    if (p) out.add(p);
  }
  return out;
}

let memo: { raw: string; set: Set<string> } | null = null;

/** True when the number is in the break-glass ALLOWED_PHONES (normalized on both sides). False when it is unset. */
export function isAllowedPhone(phone: string): boolean {
  const raw = allowedPhonesRaw();
  if (!raw) return false;
  if (!memo || memo.raw !== raw) memo = { raw, set: parsePhoneList(raw) };
  const p = normalizePhone(phone);
  return p !== null && memo.set.has(p);
}
