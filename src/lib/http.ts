import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "./env";
import { isJsonRequest, isSameOrigin } from "./security";

export const MSG = {
  notReady: "ระบบยังไม่พร้อม กรุณาติดต่อผู้ดูแล",
  badRequest: "คำขอไม่ถูกต้อง",
  sessionExpired: "หมดเวลายืนยันตัวตน กรุณาเข้าสู่ระบบด้วย LINE อีกครั้ง",
  invalidEmail: "รูปแบบอีเมลไม่ถูกต้อง",
  // U+00A0 keeps "6 หลัก" together and U+2060 keeps "(รวมถึงจดหมายขยะ)" on one line (Thai line breaking)
  sent: "ส่งรหัส 6\u00A0หลักไปที่อีเมลแล้ว กรุณาตรวจสอบกล่องจดหมาย (รวม\u2060ถึง\u2060จดหมาย\u2060ขยะ)",
  tooMany: "ขอรหัสบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
  tooManyToday: "ขอรหัสครบจำนวนต่อวันแล้ว",
  wrongCode: "รหัสไม่ถูกต้อง",
  locked: "ใส่รหัสผิดเกินจำนวนครั้งที่กำหนด กรุณาขอรหัสใหม่",
  expired: "รหัสหมดอายุหรือยังไม่ได้ขอรหัส กรุณาขอรหัสใหม่",
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
