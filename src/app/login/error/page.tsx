import Link from "next/link";
import { AuthShell, Notice } from "@/components/auth-shell";

const MESSAGES: Record<string, { title: string; body: string }> = {
  cancelled: { title: "ยกเลิกการเข้าสู่ระบบ", body: "คุณยกเลิกการเข้าสู่ระบบด้วย LINE" },
  state: {
    title: "ลิงก์เข้าสู่ระบบหมดอายุ",
    body: "ลิงก์เข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง กรุณาเริ่มเข้าสู่ระบบใหม่อีกครั้ง",
  },
  line: { title: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ", body: "ไม่สามารถยืนยันตัวตนกับ LINE ได้ กรุณาลองใหม่อีกครั้ง" },
  config: { title: "ระบบยังไม่พร้อม", body: "ระบบยังไม่พร้อม กรุณาติดต่อผู้ดูแล" },
  failed: { title: "เกิดข้อผิดพลาด", body: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" },
};

export default async function LoginErrorPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const sp = await searchParams;
  const code = typeof sp.code === "string" && Object.hasOwn(MESSAGES, sp.code) ? sp.code : "failed";
  const msg = MESSAGES[code];
  return (
    <AuthShell title={msg.title}>
      <div data-testid="login-error" data-code={code}>
        <Notice tone="warning" role="alert">
          {msg.body}
        </Notice>
        <Link className="btn btn-primary mt-5 min-h-12 w-full" href="/login">
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    </AuthShell>
  );
}
