import { notFound } from "next/navigation";
import { RegisterForm } from "@/components/register-form";

export const dynamic = "force-dynamic";

export default function PreviewRegisterPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <main className="flex h-dvh overflow-y-auto overscroll-contain bg-floor px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="glass m-auto w-full max-w-md rounded-3xl border border-white/60 p-6 sm:p-8">
        <p className="brand-glow text-sm font-medium tracking-[0.04em] text-label">ORSKH.APP</p>
        <h1 className="mt-2 text-2xl font-semibold">ลงทะเบียน</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          โหมดตัวอย่างสำหรับตรวจฟอร์มและหน้าต่างยืนยัน ไม่ได้บันทึกลงฐานข้อมูล
        </p>
        <RegisterForm preview />
      </div>
    </main>
  );
}
