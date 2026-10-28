import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { cookieName } from "../cookies";
import { sessionSecret } from "../env";
import { verifyAccess, verifyPending, type AccessGrant, type PendingLogin } from "../tokens";
import { userFromToken, type SessionUser } from "./user";

function name(kind: "session" | "pending" | "access"): string | null {
  try {
    return cookieName(kind);
  } catch {
    return null; // APP_URL missing: nobody is signed in
  }
}

/** Current user (deduplicated per request). Reading cookies makes the route dynamic. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const n = name("session");
  return n ? userFromToken(jar.get(n)?.value) : null;
});

/**
 * Use at the top of EVERY protected page (and layout). Layouts alone are not enough:
 * they are not re-rendered on client navigation.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function getPendingLogin(): Promise<PendingLogin | null> {
  const jar = await cookies();
  const n = name("pending");
  if (!n) return null;
  try {
    return await verifyPending(jar.get(n)?.value, sessionSecret());
  } catch {
    return null;
  }
}

/** Verified-but-not-authorized email of this browser (set by /api/auth/otp/verify), or null. */
export async function getAccessGrant(): Promise<AccessGrant | null> {
  const jar = await cookies();
  const n = name("access");
  if (!n) return null;
  try {
    return await verifyAccess(jar.get(n)?.value, sessionSecret());
  } catch {
    return null;
  }
}
