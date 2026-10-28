import "server-only";
import { hkdfSync } from "node:crypto";
import { EncryptJWT, jwtDecrypt, jwtVerify, SignJWT } from "jose";

/**
 * Token formats (all keyed from SESSION_SECRET):
 * - session: HS256 JWT, key = SESSION_SECRET bytes, aud "session", 30 days
 * - pending: HS256 JWT, key = HKDF(SESSION_SECRET, "pending"), aud "pending", 15 min
 * - access: HS256 JWT, key = HKDF(SESSION_SECRET, "access"), aud "access", 12 h (verified email that is not
 *   authorized yet: lets its owner request access and wait for the decision, never a session)
 * - LINE tx: JWE dir/A256GCM, key = HKDF(SESSION_SECRET, "line-tx"), 10 min (unreadable by the client)
 */
export const ISSUER = "orskh";
export const SESSION_TTL_S = 30 * 24 * 3600;
export const PENDING_TTL_S = 15 * 60;
export const TX_TTL_S = 10 * 60;
export const ACCESS_TTL_S = 12 * 3600;

export interface SessionUser {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface PendingLogin {
  sub: string;
  name: string;
  picture: string | null;
  next: string;
}

/** A LINE account that proved ownership of an email which is not (yet) authorized. */
export interface AccessGrant {
  sub: string;
  name: string;
  picture: string | null;
  email: string;
}

export interface LineTx {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
}

const enc = new TextEncoder();

/** HKDF-SHA256(SESSION_SECRET) with a per-purpose label, so keys for different uses never coincide. */
export function deriveKey(secret: string, label: string): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", enc.encode(secret), enc.encode(ISSUER), enc.encode(label), 32));
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

export async function signSession(u: SessionUser, secret: string, ttlS = SESSION_TTL_S): Promise<string> {
  return new SignJWT({ email: u.email, name: u.name, picture: u.picture })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(u.sub)
    .setIssuer(ISSUER)
    .setAudience("session")
    .setIssuedAt()
    .setExpirationTime(`${ttlS}s`)
    .sign(enc.encode(secret));
}

/** Verifies signature, issuer, audience and expiry. Returns null for anything invalid. */
export async function verifySession(token: string | undefined, secret: string): Promise<SessionUser | null> {
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, enc.encode(secret), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: "session",
      requiredClaims: ["exp", "iat", "sub"],
    });
    const sub = str(payload.sub, 128);
    const email = str(payload.email, 254);
    if (!sub || !email) return null;
    return { sub, email, name: str(payload.name, 200) ?? "", picture: str(payload.picture, 1024) };
  } catch {
    return null;
  }
}

export async function signPending(p: PendingLogin, secret: string, ttlS = PENDING_TTL_S): Promise<string> {
  return new SignJWT({ name: p.name, picture: p.picture, next: p.next })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(p.sub)
    .setIssuer(ISSUER)
    .setAudience("pending")
    .setIssuedAt()
    .setExpirationTime(`${ttlS}s`)
    .sign(deriveKey(secret, "pending"));
}

export async function verifyPending(token: string | undefined, secret: string): Promise<PendingLogin | null> {
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, deriveKey(secret, "pending"), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: "pending",
      requiredClaims: ["exp", "sub"],
    });
    const sub = str(payload.sub, 128);
    if (!sub) return null;
    return {
      sub,
      name: str(payload.name, 200) ?? "",
      picture: str(payload.picture, 1024),
      next: str(payload.next, 512) ?? "/",
    };
  } catch {
    return null;
  }
}

export async function signAccess(a: AccessGrant, secret: string, ttlS = ACCESS_TTL_S): Promise<string> {
  return new SignJWT({ name: a.name, picture: a.picture, email: a.email })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(a.sub)
    .setIssuer(ISSUER)
    .setAudience("access")
    .setIssuedAt()
    .setExpirationTime(`${ttlS}s`)
    .sign(deriveKey(secret, "access"));
}

export async function verifyAccess(token: string | undefined, secret: string): Promise<AccessGrant | null> {
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, deriveKey(secret, "access"), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: "access",
      requiredClaims: ["exp", "sub"],
    });
    const sub = str(payload.sub, 128);
    const email = str(payload.email, 254);
    if (!sub || !email) return null;
    return { sub, name: str(payload.name, 200) ?? "", picture: str(payload.picture, 1024), email };
  } catch {
    return null;
  }
}

export async function sealTx(tx: LineTx, secret: string, ttlS = TX_TTL_S): Promise<string> {
  return new EncryptJWT({ state: tx.state, nonce: tx.nonce, verifier: tx.verifier, next: tx.next })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(ISSUER)
    .setAudience("line-tx")
    .setIssuedAt()
    .setExpirationTime(`${ttlS}s`)
    .encrypt(deriveKey(secret, "line-tx"));
}

export async function openTx(token: string | undefined, secret: string): Promise<LineTx | null> {
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtDecrypt(token, deriveKey(secret, "line-tx"), {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
      issuer: ISSUER,
      audience: "line-tx",
      requiredClaims: ["exp"],
    });
    const state = str(payload.state, 128);
    const nonce = str(payload.nonce, 128);
    const verifier = str(payload.verifier, 128);
    if (!state || !nonce || !verifier) return null;
    return { state, nonce, verifier, next: str(payload.next, 512) ?? "/" };
  } catch {
    return null;
  }
}
