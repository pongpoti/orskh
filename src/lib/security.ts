import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison (hashes first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Returns a same-origin relative path ("/x?y") or "/" for anything else.
 * Rejects absolute URLs, protocol-relative "//" (before and after dot-segment normalization),
 * backslashes and control characters.
 */
export function safeNextPath(input: unknown): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 512) return "/";
  if (!input.startsWith("/") || input.startsWith("//") || input.startsWith("/\\")) return "/";
  if (/[\\\u0000-\u001f\u007f]/.test(input)) return "/";
  try {
    const base = "http://n.invalid";
    const u = new URL(input, base);
    if (u.origin !== base) return "/";
    if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/login")) return "/";
    const out = `${u.pathname}${u.search}` || "/";
    // Check the normalized result too: "/.//x" or "/a/..//x" collapse to the protocol-relative "//x".
    if (out.startsWith("//") || out.startsWith("/\\")) return "/";
    return out;
  } catch {
    return "/";
  }
}

/** CSRF: Origin (fallback Referer) must equal the app origin. Missing both is rejected. */
export function isSameOrigin(headers: Headers, appOrigin: string): boolean {
  const origin = headers.get("origin");
  if (origin !== null) return origin === appOrigin;
  const referer = headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === appOrigin;
  } catch {
    return false;
  }
}

export function isJsonRequest(headers: Headers): boolean {
  const ct = headers.get("content-type") ?? "";
  return /^application\/json(\s*;|$)/i.test(ct.trim());
}

/** Client IP. On Vercel x-real-ip / x-forwarded-for are set by the platform (not spoofable). */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = real || fwd || "unknown";
  return ip.slice(0, 64);
}

export function userAgent(headers: Headers): string {
  return (headers.get("user-agent") ?? "").slice(0, 300);
}

/** Reads a small JSON object body. Returns null on oversize or invalid JSON. */
export async function readJsonBody(req: Request, maxBytes = 2048): Promise<Record<string, unknown> | null> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) return null;
  let text: string;
  try {
    text = await req.text();
  } catch {
    return null;
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
