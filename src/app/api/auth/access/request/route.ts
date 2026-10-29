import { after, NextResponse, type NextRequest } from "next/server";
import { cleanPersonName, createRequest, parsePosition, saveTelegramRefs } from "@/lib/access";
import { accessGrantFor } from "@/lib/access-http";
import { db } from "@/lib/db";
import { guardPost, json, MSG } from "@/lib/http";
import { logEvent } from "@/lib/otp";
import { clientIp, readJsonBody, userAgent } from "@/lib/security";
import { ensureWebhook, sendRequestMessages } from "@/lib/telegram";

/** Stores an access request (name + position) for the verified number and asks the administrators in Telegram. */
export async function POST(req: NextRequest) {
  const blocked = guardPost(req);
  if (blocked) return blocked;
  const grant = await accessGrantFor(req);
  if (grant instanceof NextResponse) return grant;

  const body = await readJsonBody(req);
  const firstName = cleanPersonName(body?.firstName);
  if (!firstName) return json({ error: MSG.firstName, field: "firstName" }, 400);
  const lastName = cleanPersonName(body?.lastName);
  if (!lastName) return json({ error: MSG.lastName, field: "lastName" }, 400);
  const position = parsePosition(body?.position);
  if (!position) return json({ error: MSG.position, field: "position" }, 400);

  const ip = clientIp(req.headers);
  const ua = userAgent(req.headers);
  try {
    const pool = await db();
    const result = await createRequest(pool, {
      phone: grant.phone,
      sub: grant.sub,
      lineName: grant.name,
      firstName,
      lastName,
      position,
      ip,
    });
    if (result.status === "limited") {
      await logEvent(pool, { event: "access_request_limited", sub: grant.sub, phone: grant.phone, ip, userAgent: ua });
      return json({ error: MSG.requestTooMany, retryAfter: result.retryAfterS }, 429, {
        headers: { "Retry-After": String(result.retryAfterS) },
      });
    }
    if (result.status === "exists") {
      if (result.view === "rejected") return json({ error: MSG.requestRejected, status: "rejected" }, 409);
      return json({ ok: true, status: result.view });
    }
    await logEvent(pool, { event: "access_requested", sub: grant.sub, phone: grant.phone, ip, userAgent: ua });
    const request = result.request;
    // After the response: Telegram being slow or down never fails the request (it stays pending).
    after(async () => {
      try {
        await ensureWebhook();
      } catch (e) {
        console.error("[access] webhook registration failed:", (e as Error).message);
      }
      try {
        const sent = await sendRequestMessages(request);
        if (sent.length) await saveTelegramRefs(pool, request.id, sent);
        else console.error("[access] request", request.id, "was not sent to Telegram");
      } catch (e) {
        console.error("[access] notifying Telegram failed:", (e as Error).message);
      }
    });
    return json({ ok: true, status: "pending" });
  } catch (e) {
    console.error("[access] request failed:", (e as Error).message);
    return json({ error: MSG.notReady }, 503);
  }
}
