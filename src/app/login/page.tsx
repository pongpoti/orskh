import { redirect } from "next/navigation";
import { auth, lineLoginConfigured } from "@/auth";
import { LineLoginButton } from "@/components/line-login-button";
import { isUserAllowed } from "@/lib/allowlist";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  Configuration: "ตั้งค่า LINE Login ยังไม่ครบ",
  AccessDenied: "LINE ปฏิเสธการเข้าสู่ระบบ",
  Verification: "ยืนยันตัวตนไม่สำเร็จ",
  OAuthSignin: "เริ่มเข้าสู่ระบบกับ LINE ไม่สำเร็จ",
  OAuthCallback: "LINE ส่งกลับมาไม่สำเร็จ ตรวจ Callback URL ของช่อง",
  Callback: "LINE ส่งกลับมาไม่สำเร็จ ตรวจ Callback URL ของช่อง",
  Default: "เข้าสู่ระบบไม่สำเร็จ ลองอีกครั้ง",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) {
    if (!isUserAllowed(session.user.id)) redirect("/pending");
    redirect(session.user.registered ? "/" : "/register");
  }

  const params = await searchParams;
  const error = params.error ? (ERRORS[params.error] ?? ERRORS.Default) : null;
  const configured = lineLoginConfigured();

  return (
    <main className="flex h-dvh overflow-y-auto overscroll-contain bg-canvas px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="glass m-auto w-full max-w-md rounded-3xl border border-white/60 p-6 sm:p-8 text-center">
        <p className="brand-glow text-xl font-semibold tracking-[0.04em] text-label">ORSKH.APP</p>
        <h1 className="mt-3 text-2xl font-semibold">ตารางห้องผ่าตัด</h1>
        <p className="mt-2 text-sm leading-6 text-muted">เข้าสู่ระบบ เพื่อดูเคสผ่าตัดของวันนี้</p>
        {error ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-6">
          {configured ? (
            <LineLoginButton />
          ) : (
            <p className="rounded-xl bg-canvas px-3 py-3 text-sm text-muted">
              ยังไม่ได้ตั้งค่า LINE Login บนเซิร์ฟเวอร์
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
