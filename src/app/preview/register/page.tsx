import { notFound } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { RegisterForm } from "@/components/register-form";

export const dynamic = "force-dynamic";

export default function PreviewRegisterPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <AuthShell
      title="ลงทะเบียน"
      description="โหมดตัวอย่างสำหรับตรวจฟอร์มและหน้าต่างยืนยัน ไม่ได้บันทึกลงฐานข้อมูล"
    >
      <RegisterForm preview />
    </AuthShell>
  );
}
