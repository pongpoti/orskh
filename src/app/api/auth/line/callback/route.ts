import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedPhone } from "@/lib/authz";
import { clearCookie, cookieName, setCookie } from "@/lib/cookies";
import { db } from "@/lib/db";
import { appUrl, ConfigError, lineConfig, sessionSecret } from "@/lib/env";
import { redirectToError, type ErrorCode } from "@/lib/http";
import { exchangeCode, LineAuthError, verifyIdToken } from "@/lib/line";
import { findFreshBinding, logEvent, touchBinding } from "@/lib/otp";
import { clientIp, safeEqual, safeNextPath, userAgent } from "@/lib/security";
import { openTx, signPending, signSession } from "@/lib/tokens";

function fail(req: NextRequest, code: ErrorCode): NextResponse {
  const res = redirectToError(req, code);
  try {
    clearCookie(res, "tx");
  } catch {
    // APP_URL missing: no cookie could have been set
  }
  return res;
}

/** LINE redirects here with ?code&state (or ?error). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  try {
    const cfg = lineConfig();
    const secret = sessionSecret();
    const origin = appUrl().origin;

    const tx = await openTx(req.cookies.get(cookieName("tx"))?.value, secret);
    const state = q.get("state") ?? "";
    const stateOk = tx !== null && state.length > 0 && safeEqual(state, tx.state);

    if (q.get("error")) {
      // access_denied = user cancelled on the LINE consent screen
      return fail(req, stateOk && q.get("error") === "access_denied" ? "cancelled" : "line");
    }
    if (!tx || !stateOk) return fail(req, "state");
    const code = q.get("code");
    if (!code || code.length > 512) return fail(req, "line");

    const idToken = await exchangeCode(cfg, code, tx.verifier);
    const profile = await verifyIdToken(cfg, idToken, tx.nonce);
    const next = safeNextPath(tx.next);

    // Fast path: this LINE account was verified by an SMS code within 180 days and the number is still
    // authorized (an active physicians row, an approved access request, or ALLOWED_PHONES).
    let pool;
    try {
      pool = await db();
    } catch (e) {
      if (e instanceof ConfigError) throw e;
      console.error("[auth] database unavailable:", (e as Error).message);
      return fail(req, "config");
    }
    const binding = await findFreshBinding(pool, profile.sub);
    if (binding && (await isAuthorizedPhone(binding.phone))) {
      await touchBinding(pool, profile.sub, profile.name);
      await logEvent(pool, {
        event: "login_binding",
        sub: profile.sub,
        phone: binding.phone,
        ip: clientIp(req.headers),
        userAgent: userAgent(req.headers),
      });
      const token = await signSession(
        { sub: profile.sub, phone: binding.phone, name: profile.name, picture: profile.picture },
        secret,
      );
      const res = NextResponse.redirect(new URL(next, origin), 303);
      res.headers.set("Cache-Control", "no-store");
      clearCookie(res, "tx");
      clearCookie(res, "pending");
      clearCookie(res, "access");
      setCookie(res, "session", token);
      return res;
    }

    // Otherwise: prove a mobile number first (then sign in, or request access if it is not authorized).
    const pending = await signPending({ sub: profile.sub, name: profile.name, picture: profile.picture, next }, secret);
    const res = NextResponse.redirect(new URL("/login/verify", origin), 303);
    res.headers.set("Cache-Control", "no-store");
    clearCookie(res, "tx");
    setCookie(res, "pending", pending);
    return res;
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error("[auth] LINE callback not configured:", e.names.join(", "));
      return fail(req, "config");
    }
    if (e instanceof LineAuthError) {
      console.error("[auth] LINE verification failed:", e.message);
      return fail(req, "line");
    }
    console.error("[auth] LINE callback failed:", (e as Error).message);
    return fail(req, "failed");
  }
}
