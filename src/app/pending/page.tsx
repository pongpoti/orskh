import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthShell } from "@/components/auth-shell";
import { SignOutButton } from "@/components/sign-out-button";
import { isUserAllowed } from "@/lib/allowlist";

export const dynamic = "force-dynamic";

export default async function PendingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (isUserAllowed(session.user.id)) redirect(session.user.registered ? "/" : "/register");

  return (
    <AuthShell
      title="ยังไม่ได้รับสิทธิ์"
      description="เข้าสู่ระบบแล้ว แต่บัญชีนี้ยังไม่อยู่ในรายชื่อเจ้าหน้าที่ ส่งรหัสด้านล่างให้ผู้ดูแลเพื่อเพิ่มใน AUTH_LINE_ALLOWLIST"
    >
      <p className="text-sm font-semibold text-ink-2">รหัสผู้ใช้ LINE</p>
      <p className="mt-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2.5 font-mono text-sm break-all text-ink">
        {session.user.id || "ไม่มีรหัส"}
      </p>
      <div className="mt-6">
        <SignOutButton showLabel />
      </div>
    </AuthShell>
  );
}
