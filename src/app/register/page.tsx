import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthShell } from "@/components/auth-shell";
import { RegisterForm } from "@/components/register-form";
import { SignOutButton } from "@/components/sign-out-button";
import { isUserAllowed } from "@/lib/allowlist";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isUserAllowed(session.user.id)) redirect("/pending");
  if (session.user.registered) redirect("/");

  return (
    <AuthShell
      title="ลงทะเบียน"
      description="เลือกตำแหน่งและชื่อให้ตรงกับตัวคุณ ระบบจะจำบัญชี LINE นี้ไว้ ครั้งถัดไปไม่ต้องลงทะเบียนอีก"
    >
      {session.user.name ? (
        <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink-2">
          บัญชี LINE <span className="font-semibold text-ink">{session.user.name}</span>
        </p>
      ) : null}
      <RegisterForm />
      <div className="mt-3">
        <SignOutButton showLabel />
      </div>
    </AuthShell>
  );
}
