import { notFound } from "next/navigation";
import { RegisterForm } from "@/components/register-form";

export const dynamic = "force-dynamic";

export default function PreviewRegisterPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-floor px-4 py-8">
      <div className="w-full max-w-md rounded-3xl border border-ink/10 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-label">orskh</p>
        <h1 className="mt-2 text-2xl font-semibold">ลงทะเบียน</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          โหมดตัวอย่างสำหรับตรวจฟอร์มและหน้าต่างยืนยัน ไม่ได้บันทึกลงฐานข้อมูล
        </p>
        <RegisterForm preview />
      </div>
    </main>
  );
}
