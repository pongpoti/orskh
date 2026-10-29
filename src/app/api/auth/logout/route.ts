import { NextResponse, type NextRequest } from "next/server";
import { userFromToken } from "@/lib/auth/user";
import { clearCookie, cookieName } from "@/lib/cookies";
import { db } from "@/lib/db";
import { guardPost } from "@/lib/http";
import { logEvent } from "@/lib/otp";
import { clientIp, userAgent } from "@/lib/security";

export async function POST(req: NextRequest) {
  const blocked = guardPost(req);
  if (blocked) return blocked;
  const user = await userFromToken(req.cookies.get(cookieName("session"))?.value);
  if (user) {
    try {
      await logEvent(await db(), {
        event: "logout",
        sub: user.sub,
        phone: user.phone,
        ip: clientIp(req.headers),
        userAgent: userAgent(req.headers),
      });
    } catch {
      // logging is best effort; logout must always succeed
    }
  }
  const res = NextResponse.json({ ok: true, redirect: "/login" }, { headers: { "Cache-Control": "no-store" } });
  clearCookie(res, "session");
  clearCookie(res, "pending");
  clearCookie(res, "access");
  return res;
}
