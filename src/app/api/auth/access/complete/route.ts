import { NextResponse, type NextRequest } from "next/server";
import { approvedRequest } from "@/lib/access";
import { accessGrantFor } from "@/lib/access-http";
import { noteApproved } from "@/lib/authz";
import { clearCookie, setCookie } from "@/lib/cookies";
import { db } from "@/lib/db";
import { sessionSecret } from "@/lib/env";
import { guardPost, json, MSG } from "@/lib/http";
import { logEvent, upsertBinding } from "@/lib/otp";
import { clientIp, userAgent } from "@/lib/security";
import { signSession } from "@/lib/tokens";

/**
 * Signs in the waiting page once its request is approved. Re-checks in the database that THIS email has an
 * approved request made from THIS LINE account, binds the account (later LINE logins skip the code) and
 * replaces the access cookie with a normal session.
 */
export async function POST(req: NextRequest) {
  const blocked = guardPost(req);
  if (blocked) return blocked;
  const grant = await accessGrantFor(req);
  if (grant instanceof NextResponse) return grant;
  try {
    const pool = await db();
    const approved = await approvedRequest(pool, grant.email, grant.sub);
    if (!approved) return json({ error: MSG.notApproved }, 403);
    await upsertBinding(pool, grant.sub, grant.email, grant.name);
    noteApproved(grant.email);
    await logEvent(pool, {
      event: "login_access",
      sub: grant.sub,
      email: grant.email,
      ip: clientIp(req.headers),
      userAgent: userAgent(req.headers),
    });
    const token = await signSession({ sub: grant.sub, email: grant.email, name: grant.name, picture: grant.picture }, sessionSecret());
    const res = NextResponse.json({ ok: true, redirect: "/" }, { headers: { "Cache-Control": "no-store" } });
    clearCookie(res, "access");
    clearCookie(res, "pending");
    setCookie(res, "session", token);
    return res;
  } catch (e) {
    console.error("[access] sign-in failed:", (e as Error).message);
    return json({ error: MSG.notReady }, 503);
  }
}
