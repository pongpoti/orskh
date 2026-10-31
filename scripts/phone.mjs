// Thai mobile numbers for the dev scripts (scripts/dev-session.mjs): the same rules as src/lib/phone.ts, which is
// server-only TypeScript (tests/unit/phone.test.ts keeps the two identical).

// Same pattern as PHONE_RE in lib/phone.ts: Thai mobile numbers, canonical form.
export const PHONE_RE = /^0[689]\d{8}$/;

/**
 * As normalizePhone() in lib/phone.ts: NFKC, Thai digits to ASCII, spaces, dashes, dots and parentheses removed;
 * 0XXXXXXXXX, 66XXXXXXXXX and +66XXXXXXXXX (also with the 0 kept: +660XXXXXXXXX) accepted. Returns the canonical
 * "0812345678", or null.
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizePhone(input) {
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
