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
    <main className="flex min-h-dvh items-center justify-center bg-floor px-4">
      <div className="w-full max-w-md rounded-3xl border border-ink/10 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-label">orskh</p>
        <h1 className="mt-2 text-2xl font-semibold">แผนกห้องผ่าตัด</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          เข้าสู่ระบบด้วย LINE เพื่อดูแปลนห้องและรายการผ่าตัดของแต่ละห้อง
        </p>
        {error ? (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-6">
          {configured ? (
            <LineLoginButton />
          ) : (
            <p className="rounded-xl bg-floor px-3 py-3 text-sm text-muted">
              ยังไม่ได้ตั้งค่า LINE Login บนเซิร์ฟเวอร์
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
