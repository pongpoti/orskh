import { after, NextResponse, type NextRequest } from "next/server";
import { approvedRequest } from "@/lib/access";
import { isAuthorizedEmail } from "@/lib/authz";
import { clearCookie, cookieName, setCookie } from "@/lib/cookies";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import { assertOtpReady, ConfigError, otpPepper, sessionSecret, telegramEnabled } from "@/lib/env";
import { guardPost, json, MSG } from "@/lib/http";
import { countOtpEmails, logEvent, otpHistory, upsertBinding, verifyCode } from "@/lib/otp";
import { physicianFor } from "@/lib/physician-list";
import { clientIp, readJsonBody, safeNextPath, userAgent } from "@/lib/security";
import { notifyVerified } from "@/lib/telegram";
import { signAccess, signSession, verifyPending } from "@/lib/tokens";

export async function POST(req: NextRequest) {
  const blocked = guardPost(req);
  if (blocked) return blocked;

  try {
    assertOtpReady();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error("[otp] not configured:", e.names.join(", "));
      return json({ error: MSG.notReady }, 503);
    }
    throw e;
  }

  const secret = sessionSecret();
  const pending = await verifyPending(req.cookies.get(cookieName("pending"))?.value, secret);
  if (!pending) return json({ error: MSG.sessionExpired, restart: true }, 401);

  const body = await readJsonBody(req);
  const email = normalizeEmail(body?.email);
  // Accept full-width (NFKC) and Thai digits, ignore spaces.
  const code =
    typeof body?.code === "string"
      ? body.code
          .normalize("NFKC")
          .replace(/[\u0E50-\u0E59]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
          .replace(/\s+/g, "")
      : "";
  if (!email) return json({ error: MSG.invalidEmail }, 400);
  if (!/^\d{6}$/.test(code)) return json({ error: MSG.wrongCode, reason: "format" }, 400);

  const ip = clientIp(req.headers);
  const ua = userAgent(req.headers);
  try {
    const pool = await db();
    const result = await verifyCode(pool, { email, sub: pending.sub, code, pepper: otpPepper() });
    if (result.ok && !(await isAuthorizedEmail(email, { fresh: true }))) {
      // The address is proven but not authorized: no session. A short-lived access cookie lets this
      // LINE account ask for access (/login/request) and wait for an administrator's decision.
      await logEvent(pool, { event: "otp_verified_unlisted", sub: pending.sub, email, ip, userAgent: ua });
      const grant = await signAccess({ sub: pending.sub, name: pending.name, picture: pending.picture, email }, secret);
      const res = NextResponse.json({ ok: true, redirect: "/login/request" }, { headers: { "Cache-Control": "no-store" } });
      clearCookie(res, "pending");
      setCookie(res, "access", grant);
      return res;
    }
    if (result.ok) {
      await upsertBinding(pool, pending.sub, email, pending.name);
      // Read before this login is logged, so the history only holds earlier verifications.
      const history = telegramEnabled()
        ? await otpHistory(pool, email, pending.sub).catch((e) => {
            console.error("[alert] history lookup failed:", (e as Error).message);
            return undefined;
          })
        : undefined;
      await logEvent(pool, { event: "login_otp", sub: pending.sub, email, ip, userAgent: ua });
      if (history) {
        // After the response: a slow or failing Telegram never delays or breaks the sign-in.
        const at = new Date();
        after(async () => {
          const verifiedEmails = await countOtpEmails(pool).catch(() => 0);
          const physician = await physicianFor(pool, email);
          // No physicians row: the approved request (if any) gives the name and position the alert shows.
          const requester = physician ? null : await approvedRequest(pool, email).catch(() => null);
          await notifyVerified({ physician, requester, lineName: pending.name, email, at, history, verifiedEmails });
        });
      }
      const token = await signSession({ sub: pending.sub, email, name: pending.name, picture: pending.picture }, secret);
      const res = NextResponse.json({ ok: true, redirect: safeNextPath(pending.next) }, { headers: { "Cache-Control": "no-store" } });
      clearCookie(res, "pending");
      clearCookie(res, "access");
      setCookie(res, "session", token);
      return res;
    }
    if (result.reason === "locked") {
      await logEvent(pool, { event: "otp_locked", sub: pending.sub, email, ip, userAgent: ua });
      return json({ ok: false, error: MSG.locked, reason: "locked", remaining: 0 }, 400);
    }
    if (result.reason === "expired") return json({ ok: false, error: MSG.expired, reason: "expired", remaining: 0 }, 400);
    await logEvent(pool, { event: "otp_failed", sub: pending.sub, email, ip, userAgent: ua });
    return json(
      { ok: false, error: `${MSG.wrongCode} เหลือโอกาสอีก ${result.remaining}\u00A0ครั้ง`, reason: "invalid", remaining: result.remaining },
      400,
    );
  } catch (e) {
    console.error("[otp] verify failed:", (e as Error).message);
    return json({ error: MSG.notReady }, 503);
  }
}
