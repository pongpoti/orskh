import { notFound } from "next/navigation";
import { AdminBar } from "@/components/admin-bar";
import { PhysicianAdmin } from "@/components/physician-admin";
import { SURGEONS } from "@/data/surgeons";

export const dynamic = "force-dynamic";

/** Development only: the admin page with the supplied surgeons. Changes stay in the page and are not saved. */
export default function PreviewAdminPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AdminBar title="จัดการรายชื่อแพทย์" name="สมหญิง ไลน์" boardHref="/preview" />
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mx-auto w-full max-w-4xl">
          <PhysicianAdmin initial={SURGEONS.map((person, index) => ({ id: index + 1, ...person }))} />
        </div>
      </main>
    </div>
  );
}
