import { redirect } from "next/navigation";
import { auth } from "@/auth";
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
    <main className="flex min-h-dvh items-center justify-center bg-floor px-4 py-8">
      <div className="w-full max-w-md rounded-3xl border border-ink/10 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-label">orskh</p>
        <h1 className="mt-2 text-2xl font-semibold">ลงทะเบียน</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          เลือกอาชีพและชื่อให้ตรงกับตัวคุณ ระบบจะจำบัญชี LINE นี้ไว้ ครั้งถัดไปไม่ต้องลงทะเบียนอีก
        </p>
        {session.user.name ? (
          <p className="mt-4 text-sm">
            บัญชี LINE <span className="font-medium">{session.user.name}</span>
          </p>
        ) : null}
        <RegisterForm />
        <div className="mt-4">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
