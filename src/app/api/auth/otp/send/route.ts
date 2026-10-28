import { after, type NextRequest } from "next/server";
import { cookieName } from "@/lib/cookies";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import { assertOtpReady, ConfigError, otpPepper, sessionSecret } from "@/lib/env";
import { waitText } from "@/lib/format";
import { guardPost, json, MSG, sleepUntil } from "@/lib/http";
import { sendOtpMail } from "@/lib/mail";
import { LIMITS, logEvent, requestCode, volumeAlertDue } from "@/lib/otp";
import { clientIp, readJsonBody, userAgent } from "@/lib/security";
import { notifyVolume } from "@/lib/telegram";
import { verifyPending } from "@/lib/tokens";

// Every accepted request takes at least this long, so response timing says nothing about the address.
const MIN_RESPONSE_MS = 700;

export async function POST(req: NextRequest) {
  const started = Date.now();
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

  const pending = await verifyPending(req.cookies.get(cookieName("pending"))?.value, sessionSecret());
  if (!pending) return json({ error: MSG.sessionExpired, restart: true }, 401);

  const body = await readJsonBody(req);
  const email = normalizeEmail(body?.email);
  if (!email) return json({ error: MSG.invalidEmail }, 400);

  const ip = clientIp(req.headers);
  try {
    const pool = await db();
    // A real code for any valid address (listed or not): ownership is proven before anything else. The limits
    // (per address, per LINE account incl. distinct addresses a day, per IP) are the same for every address.
    const result = await requestCode(pool, { email, sub: pending.sub, ip, pepper: otpPepper() });
    if (result.status === "limited") {
      await logEvent(pool, { event: "otp_rate_limited", sub: pending.sub, email, ip, userAgent: userAgent(req.headers) });
      await sleepUntil(started, MIN_RESPONSE_MS);
      // The daily limits depend only on this LINE account's own requests, so naming them reveals nothing.
      const daily = result.reason === "pair_day" || result.reason === "sub_emails";
      const error = daily ? `${MSG.tooManyToday} ลองใหม่ได้ในอีก ${waitText(result.retryAfterS)}` : MSG.tooMany;
      return json({ error, retryAfter: result.retryAfterS }, 429, {
        headers: { "Retry-After": String(result.retryAfterS) },
      });
    }
    await logEvent(pool, { event: "otp_sent", sub: pending.sub, email, ip, userAgent: userAgent(req.headers) });
    const { code, sentToday } = result;
    const alert = volumeAlertDue(sentToday);
    // Sent after the response so SMTP latency never delays (or reveals anything through) the answer.
    after(async () => {
      try {
        await sendOtpMail(email, code);
      } catch (e) {
        console.error("[otp] sending email failed:", (e as Error).message);
      }
      if (alert) {
        console.warn("[otp] codes mailed in the last 24 h:", sentToday);
        await notifyVolume(sentToday);
      }
    });
    await sleepUntil(started, MIN_RESPONSE_MS);
    return json({ ok: true, message: MSG.sent, cooldown: LIMITS.cooldownS });
  } catch (e) {
    console.error("[otp] send failed:", (e as Error).message);
    await sleepUntil(started, MIN_RESPONSE_MS);
    return json({ error: MSG.notReady }, 503);
  }
}
