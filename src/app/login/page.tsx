import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { LineLoginButton } from "@/components/line-login-button";
import { latestRequest, viewFor } from "@/lib/access";
import { getAccessGrant, getUser } from "@/lib/auth/server";
import { isListedUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { safeNextPath } from "@/lib/security";
import { claimsEnabled } from "@/lib/telegram";

/**
 * Where a browser with a verified number continues: its access request, or picking its name (only while claims are
 * open). Nothing when the number holds a name by now (claimed on another device, or set by hand): signing in with LINE,
 * the primary button, is the way on, and the claim or request pages would only lead back here.
 */
async function continueAt(phone: string, sub: string): Promise<"request" | "claim" | null> {
  if (await isListedUser(phone)) return null;
  try {
    return claimsEnabled() && viewFor(await latestRequest(await db(), phone), sub) === "form" ? "claim" : "request";
  } catch {
    return "request"; // that page reports the outage
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined);
  if (await getUser()) redirect(next);
  // A verified number that is not authorized yet (a name to pick, or an access request in progress, on this browser).
  const grant = await getAccessGrant();
  const resume = grant ? await continueAt(grant.phone, grant.sub) : null;

  return (
    <AuthShell title="ตารางห้องผ่าตัด" description="เข้าสู่ระบบเพื่อดูเคสผ่าตัดของวันนี้">
      <LineLoginButton next={next} />
      <p className="mt-4 text-center text-sm leading-6 text-muted">
        สำหรับเจ้าหน้าที่ห้องผ่าตัดที่ได้รับอนุญาตเท่านั้น
        <br />
        ครั้งแรกต้องยืนยันเบอร์มือถือด้วยรหัสทาง SMS
      </p>
      {resume === "request" ? (
        <a className="btn btn-secondary mt-4 w-full" href="/login/request" data-testid="request-status-link">
          ดูสถานะคำขอเข้าใช้งาน
        </a>
      ) : resume === "claim" ? (
        <a className="btn btn-secondary mt-4 w-full" href="/login/claim" data-testid="claim-resume-link">
          เลือกชื่อของคุณต่อ
        </a>
      ) : null}
    </AuthShell>
  );
}
