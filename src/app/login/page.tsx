import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { LineLoginButton } from "@/components/line-login-button";
import { getAccessGrant, getUser } from "@/lib/auth/server";
import { safeNextPath } from "@/lib/security";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined);
  if (await getUser()) redirect(next);
  // A verified email that is not authorized yet (access request in progress on this browser).
  const requesting = (await getAccessGrant()) !== null;

  return (
    <AuthShell title="ตารางห้องผ่าตัด" description="เข้าสู่ระบบเพื่อดูเคสผ่าตัดของวันนี้">
      <LineLoginButton next={next} />
      <p className="mt-4 text-center text-sm leading-6 text-muted">
        สำหรับแพทย์และพยาบาลที่ได้รับอนุญาตเท่านั้น
        <br />
        ครั้งแรกต้องยืนยันอีเมลด้วยรหัส 6&nbsp;หลัก
      </p>
      {requesting ? (
        <a className="btn btn-secondary mt-4 w-full" href="/login/request" data-testid="request-status-link">
          ดูสถานะคำขอเข้าใช้งาน
        </a>
      ) : null}
    </AuthShell>
  );
}
