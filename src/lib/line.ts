import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { LineConfig } from "./env";
import { safeEqual } from "./security";

export const LINE_ISSUER = "https://access.line.me";

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url"); // 43 chars, RFC 7636
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function buildAuthorizeUrl(cfg: LineConfig, p: { state: string; nonce: string; challenge: string }): string {
  const u = new URL(cfg.authorizeUrl);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: cfg.channelId,
    redirect_uri: cfg.redirectUri,
    state: p.state,
    scope: "profile openid",
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    ui_locales: "th",
  }).toString();
  return u.toString();
}

export class LineAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LineAuthError";
  }
}

async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through
  }
  if (!res.ok || !body || typeof body !== "object") {
    const err = body && typeof body === "object" ? String((body as Record<string, unknown>).error ?? "") : "";
    throw new LineAuthError(`${new URL(url).pathname} failed: HTTP ${res.status}${err ? ` ${err.slice(0, 60)}` : ""}`);
  }
  return body as Record<string, unknown>;
}

export async function exchangeCode(cfg: LineConfig, code: string, verifier: string): Promise<string> {
  const body = await postForm(cfg.tokenUrl, {
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.channelId,
    client_secret: cfg.channelSecret,
    code_verifier: verifier,
  });
  const idToken = body.id_token;
  if (typeof idToken !== "string" || idToken.length > 8192) throw new LineAuthError("token response has no id_token");
  return idToken;
}

export interface LineProfile {
  sub: string;
  name: string;
  picture: string | null;
}

/** LINE display names are user-controlled: strip control/bidi characters and cap length. */
export function cleanDisplayName(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
    .trim()
    .slice(0, 100);
}

/** Only https images from LINE's CDN are kept (matches the CSP img-src). */
export function cleanPictureUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 1024) return null;
  try {
    const u = new URL(v);
    const okHost = u.hostname === "profile.line-scdn.net" || u.hostname.endsWith(".line-scdn.net");
    return u.protocol === "https:" && okHost && !u.username && !u.password && !u.port ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Verifies the ID token with LINE's verify endpoint (which checks the signature, audience,
 * expiry and nonce) and re-checks iss, aud, exp and nonce locally.
 */
export async function verifyIdToken(cfg: LineConfig, idToken: string, nonce: string): Promise<LineProfile> {
  const c = await postForm(cfg.verifyUrl, { id_token: idToken, client_id: cfg.channelId, nonce });
  const now = Math.floor(Date.now() / 1000);
  const aud = c.aud;
  const audOk = Array.isArray(aud) ? aud.includes(cfg.channelId) : aud === cfg.channelId;
  if (c.iss !== LINE_ISSUER) throw new LineAuthError("unexpected iss");
  if (!audOk) throw new LineAuthError("unexpected aud");
  if (typeof c.exp !== "number" || c.exp <= now) throw new LineAuthError("id_token expired");
  if (typeof c.nonce !== "string" || !safeEqual(c.nonce, nonce)) throw new LineAuthError("nonce mismatch");
  if (typeof c.sub !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(c.sub)) throw new LineAuthError("invalid sub");
  return { sub: c.sub, name: cleanDisplayName(c.name), picture: cleanPictureUrl(c.picture) };
}
