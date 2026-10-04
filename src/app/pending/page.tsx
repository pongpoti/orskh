import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { isUserAllowed } from "@/lib/allowlist";

export const dynamic = "force-dynamic";

export default async function PendingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (isUserAllowed(session.user.id)) redirect(session.user.registered ? "/" : "/register");

  return (
    <main className="flex h-dvh items-center justify-center overflow-y-auto overscroll-contain bg-floor px-4">
      <div className="glass w-full max-w-md rounded-3xl border border-white/50 p-8">
        <p className="text-sm font-medium text-label">orskh</p>
        <h1 className="mt-2 text-2xl font-semibold">ยังไม่ได้รับสิทธิ์</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          เข้าสู่ระบบแล้ว แต่บัญชีนี้ยังไม่อยู่ในรายชื่อเจ้าหน้าที่ ส่งรหัสด้านล่างให้ผู้ดูแลเพื่อเพิ่มใน AUTH_LINE_ALLOWLIST
        </p>
        <p className="mt-4 text-xs text-muted">รหัสผู้ใช้ LINE</p>
        <p className="mt-1 break-all rounded-xl bg-floor px-3 py-2 font-mono text-sm">{session.user.id || "ไม่มีรหัส"}</p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
