import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { SmsConfig } from "../env";
import { codeMatches, generateCode, hashCode, type OtpTransport } from "../otp";
import { requestOtp, verifyOtp, type CallOptions } from "./deesmsx";
import { deliverLocal, generateRef } from "./local";

/**
 * One interface (OtpTransport in lib/otp.ts) for both ways of sending a code:
 * - provider mode (SMS_PROVIDER=deesmsx, the only one on Vercel): deeSMSX makes, sends and checks the code. Its token
 *   is kept server-side only, encrypted with a key derived from OTP_PEPPER;
 * - local mode (console / file, development and tests): the app makes the code, stores HMAC(OTP_PEPPER, phone|sub|code)
 *   and compares in constant time.
 */

const TOKEN_PREFIX = "v1.";

function tokenKey(pepper: string): Buffer {
  return Buffer.from(hkdfSync("sha256", pepper, "orskh", "otp-provider-token", 32));
}

/** AES-256-GCM, so the provider's token is useless to anyone who reads the database without OTP_PEPPER. */
export function sealToken(pepper: string, token: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", tokenKey(pepper), iv);
  const ct = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return TOKEN_PREFIX + Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64url");
}

/** The token, or null when it was sealed with another pepper or altered. */
export function openToken(pepper: string, sealed: string): string | null {
  if (!sealed.startsWith(TOKEN_PREFIX)) return null;
  const raw = Buffer.from(sealed.slice(TOKEN_PREFIX.length), "base64url");
  if (raw.length < 12 + 16 + 1) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", tokenKey(pepper), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function smsTransport(cfg: SmsConfig, opts: CallOptions = {}): OtpTransport {
  if (cfg.kind === "deesmsx") {
    return {
      async issue({ phone, pepper }) {
        const r = await requestOtp(cfg, phone, opts);
        if (!r.ok) return { ok: false, reason: r.reason, providerCode: r.code };
        return {
          ok: true,
          ref: r.ref,
          stored: { codeHash: null, providerToken: sealToken(pepper, r.token) },
          creditBalance: r.creditBalance,
        };
      },
      async check({ pepper, code, stored }) {
        const token = stored.providerToken ? openToken(pepper, stored.providerToken) : null;
        if (!token) {
          // A local-mode row, or OTP_PEPPER changed since the code was sent: ask for a new code.
          return { ok: false, reason: "expired", providerCode: null };
        }
        const r = await verifyOtp(cfg, token, code, opts);
        return r.ok ? { ok: true } : { ok: false, reason: r.reason, providerCode: r.code };
      },
    };
  }
  return {
    async issue({ phone, sub, pepper }) {
      const code = generateCode();
      const ref = generateRef();
      try {
        await deliverLocal(cfg, { to: phone, code, ref });
      } catch (e) {
        console.error("[sms] local delivery failed:", (e as Error).message);
        return { ok: false, reason: "failed", providerCode: null };
      }
      return { ok: true, ref, stored: { codeHash: hashCode(pepper, phone, sub, code), providerToken: null }, creditBalance: null };
    },
    async check({ phone, sub, pepper, code, stored }) {
      if (!stored.codeHash) return { ok: false, reason: "expired", providerCode: null };
      return codeMatches(pepper, phone, sub, code, stored.codeHash)
        ? { ok: true }
        : { ok: false, reason: "wrong", providerCode: null };
    },
  };
}
