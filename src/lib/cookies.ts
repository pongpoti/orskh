import "server-only";
import type { NextResponse } from "next/server";
import { secureCookies } from "./env";
import { ACCESS_TTL_S, PENDING_TTL_S, SESSION_TTL_S, TX_TTL_S } from "./tokens";

export type CookieKind = "session" | "pending" | "tx" | "access";

const BASE: Record<CookieKind, string> = { session: "session", pending: "pending", tx: "line-tx", access: "access" };
const TTL: Record<CookieKind, number> = {
  session: SESSION_TTL_S,
  pending: PENDING_TTL_S,
  tx: TX_TTL_S,
  access: ACCESS_TTL_S,
};

/** "__Host-session" on https; plain "session" on http://localhost so local tests work. */
export function cookieName(kind: CookieKind, secure = secureCookies()): string {
  return secure ? `__Host-${BASE[kind]}` : BASE[kind];
}

export function cookieOptions(kind: CookieKind, secure = secureCookies()) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge: TTL[kind] };
}

export function setCookie(res: NextResponse, kind: CookieKind, value: string): void {
  const secure = secureCookies();
  res.cookies.set(cookieName(kind, secure), value, cookieOptions(kind, secure));
}

export function clearCookie(res: NextResponse, kind: CookieKind): void {
  const secure = secureCookies();
  res.cookies.set(cookieName(kind, secure), "", { ...cookieOptions(kind, secure), maxAge: 0 });
}
