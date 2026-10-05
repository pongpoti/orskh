import { redirect } from "next/navigation";
import { auth, lineLoginConfigured } from "@/auth";
import { AuthShell, Notice } from "@/components/auth-shell";
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
    <AuthShell title="ตารางห้องผ่าตัด" description="เข้าสู่ระบบเพื่อดูเคสผ่าตัดของวันนี้">
      {error ? (
        <Notice tone="warning" role="alert" className="mb-4">
          {error}
        </Notice>
      ) : null}
      {configured ? (
        <LineLoginButton />
      ) : (
        <Notice tone="info">ยังไม่ได้ตั้งค่า LINE Login บนเซิร์ฟเวอร์</Notice>
      )}
    </AuthShell>
  );
}
