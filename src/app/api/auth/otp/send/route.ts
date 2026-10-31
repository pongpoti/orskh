import { after, type NextRequest } from "next/server";
import { cookieName } from "@/lib/cookies";
import { db } from "@/lib/db";
import { assertOtpReady, ConfigError, otpPepper, sessionSecret, smsConfig } from "@/lib/env";
import { waitText } from "@/lib/format";
import { guardPost, json, MSG, sleepUntil } from "@/lib/http";
import { hasLiveCode, LIMITS, logEvent, sendCode } from "@/lib/otp";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { clientIp, readJsonBody, userAgent } from "@/lib/security";
import { smsTransport } from "@/lib/sms";
import { alertsAfterSend } from "@/lib/sms/alerts";
import { notify } from "@/lib/telegram";
import { verifyPending } from "@/lib/tokens";

// Every accepted request takes at least this long, so response timing says little about the number.
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
  const phone = normalizePhone(body?.phone);
  if (!phone) return json({ error: MSG.invalidPhone, field: "phone" }, 400);

  const ip = clientIp(req.headers);
  const ua = userAgent(req.headers);
  const cfg = smsConfig();
  try {
    const pool = await db();
    // A real code for any valid number (listed or not): ownership is proven before anything else. The limits
    // (per number, per LINE account incl. distinct numbers a day, per IP, and the global daily cap) are the same
    // for every number.
    const result = await sendCode(pool, {
      phone,
      sub: pending.sub,
      ip,
      pepper: otpPepper(),
      dailyCap: cfg.dailyCap,
      transport: smsTransport(cfg),
    });
    const alerts = alertsAfterSend(result, cfg.dailyCap);
    // After the response: a slow or failing Telegram never delays or breaks the answer.
    if (alerts.length) {
      after(async () => {
        for (const html of alerts) await notify(html);
      });
    }

    if (result.status === "limited") {
      await logEvent(pool, { event: "otp_rate_limited", sub: pending.sub, phone, ip, userAgent: ua });
      // Whether this LINE account has a usable code for this number (it can then be typed in). Only this account's
      // own requests decide it, as for the daily limits below, so it reveals nothing about anyone else.
      const codePending = await hasLiveCode(pool, phone, pending.sub);
      await sleepUntil(started, MIN_RESPONSE_MS);
      // The daily limits depend only on this LINE account's own requests, so naming them reveals nothing.
      const daily = result.reason === "pair_day" || result.reason === "sub_phones";
      const error = daily ? `${MSG.tooManyToday} ลองใหม่ได้ในอีก ${waitText(result.retryAfterS)}` : MSG.tooMany;
      return json({ error, retryAfter: result.retryAfterS, ...(codePending ? { codePending: true } : {}) }, 429, {
        headers: { "Retry-After": String(result.retryAfterS) },
      });
    }
    if (result.status === "capped") {
      console.warn("[otp] SMS_DAILY_CAP reached:", result.sentToday);
      await logEvent(pool, { event: "otp_daily_cap", sub: pending.sub, phone, ip, userAgent: ua });
      await sleepUntil(started, MIN_RESPONSE_MS);
      return json({ error: MSG.dailyCap }, 503, { headers: { "Retry-After": String(result.retryAfterS) } });
    }
    if (result.status === "failed" && result.reason === "uncertain") {
      // The SMS may have gone out: the attempt counts (the cooldown runs), and that code cannot be used.
      await logEvent(pool, { event: "otp_send_uncertain", sub: pending.sub, phone, ip, userAgent: ua });
      await sleepUntil(started, MIN_RESPONSE_MS);
      return json({ error: MSG.smsUncertain, retryAfter: LIMITS.cooldownS }, 502, {
        headers: { "Retry-After": String(LIMITS.cooldownS) },
      });
    }
    if (result.status === "failed") {
      await logEvent(pool, { event: "otp_send_failed", sub: pending.sub, phone, ip, userAgent: ua });
      await sleepUntil(started, MIN_RESPONSE_MS);
      if (result.reason === "invalid_number") return json({ error: MSG.smsRejected, field: "phone" }, 400);
      if (result.reason === "misconfigured") return json({ error: MSG.notReady }, 503);
      if (result.reason === "no_credit") return json({ error: MSG.smsUnavailable }, 503);
      return json({ error: MSG.failed }, 502);
    }
    await logEvent(pool, { event: "otp_sent", sub: pending.sub, phone, ip, userAgent: ua });
    await sleepUntil(started, MIN_RESPONSE_MS);
    return json({ ok: true, phone: formatPhone(phone), ref: result.ref, cooldown: LIMITS.cooldownS });
  } catch (e) {
    console.error("[otp] send failed:", (e as Error).message);
    await sleepUntil(started, MIN_RESPONSE_MS);
    return json({ error: MSG.notReady }, 503);
  }
}
