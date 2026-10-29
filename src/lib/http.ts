import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "./env";
import { isJsonRequest, isSameOrigin } from "./security";

export const MSG = {
  notReady: "ระบบยังไม่พร้อม กรุณาติดต่อผู้ดูแล",
  badRequest: "คำขอไม่ถูกต้อง",
  sessionExpired: "หมดเวลายืนยันตัวตน กรุณาเข้าสู่ระบบด้วย LINE อีกครั้ง",
  // U+00A0 keeps a number with its unit ("10 หลัก") on one line (Thai line breaking)
  invalidPhone: "เบอร์มือถือไม่ถูกต้อง กรุณากรอก 10\u00A0หลัก ขึ้นต้นด้วย 06, 08 หรือ 09",
  // deeSMSX refused the number (reference code 99)
  smsRejected: "ส่ง SMS ไปที่เบอร์นี้ไม่ได้ กรุณาตรวจสอบเบอร์มือถือ",
  // deeSMSX has no credit left (102)
  smsUnavailable: "ขณะนี้ระบบส่ง SMS ไม่ได้ กรุณาลองใหม่ภายหลัง หรือติดต่อผู้ดูแล",
  // deeSMSX may or may not have sent the SMS (timeout, unreadable answer); the wait is LIMITS.cooldownS
  smsUncertain: "ส่งรหัสไม่สำเร็จ หากได้รับ SMS ภายหลัง รหัสนั้นใช้ไม่ได้ กรุณารอ 1\u00A0นาทีแล้วขอรหัสใหม่",
  // SMS_DAILY_CAP reached
  dailyCap: "ระบบส่ง SMS ครบจำนวนของวันนี้แล้ว กรุณาลองใหม่ภายหลัง หรือติดต่อผู้ดูแล",
  tooMany: "ขอรหัสบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
  tooManyToday: "ขอรหัสครบจำนวนต่อวันแล้ว",
  wrongCode: "รหัสไม่ถูกต้อง",
  locked: "ใส่รหัสผิดเกินจำนวนครั้งที่กำหนด กรุณาขอรหัสใหม่",
  expired: "รหัสหมดอายุหรือใช้ไปแล้ว กรุณาขอรหัสใหม่",
  failed: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
  // access requests (/login/request)
  firstName: "กรุณากรอกชื่อเป็นตัวอักษร (ใช้ได้เฉพาะตัวอักษร ช่องว่าง . - ' ไม่เกิน 60 ตัว)",
  lastName: "กรุณากรอกนามสกุลเป็นตัวอักษร (ใช้ได้เฉพาะตัวอักษร ช่องว่าง . - ' ไม่เกิน 60 ตัว)",
  position: "กรุณาเลือกตำแหน่ง",
  requestTooMany: "ส่งคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง",
  requestRejected: "คำขอนี้ไม่ได้รับอนุมัติ กรุณาติดต่อผู้ดูแลระบบ",
  notApproved: "คำขอยังไม่ได้รับอนุมัติ",
} as const;

export function json(body: unknown, status = 200, init?: { headers?: Record<string, string> }): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}

/** Origin of the app if configured, else the request's own origin (used only for error redirects). */
export function originFor(req: NextRequest): string {
  try {
    return appUrl().origin;
  } catch {
    return req.nextUrl.origin;
  }
}

/**
 * CSRF guard for every POST: Origin (fallback Referer) must equal APP_URL's origin,
 * and the body must be JSON. Returns an error response or null when OK.
 */
export function guardPost(req: NextRequest): NextResponse | null {
  let origin: string;
  try {
    origin = appUrl().origin;
  } catch {
    return json({ error: MSG.notReady }, 503);
  }
  if (!isSameOrigin(req.headers, origin)) return json({ error: MSG.badRequest }, 403);
  if (!isJsonRequest(req.headers)) return json({ error: MSG.badRequest }, 415);
  return null;
}

export type ErrorCode = "cancelled" | "state" | "line" | "config" | "failed";

export function redirectToError(req: NextRequest, code: ErrorCode): NextResponse {
  const res = NextResponse.redirect(new URL(`/login/error?code=${code}`, originFor(req)), 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export function sleepUntil(startMs: number, minMs: number): Promise<void> {
  const wait = startMs + minMs - Date.now();
  return wait > 0 ? new Promise((r) => setTimeout(r, wait)) : Promise.resolve();
}
