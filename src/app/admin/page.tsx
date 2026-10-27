import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminBar } from "@/components/admin-bar";
import { HolidayStatus } from "@/components/holiday-status";
import { PhysicianAdmin } from "@/components/physician-admin";
import { isAdmin } from "@/lib/admin";
import { todayIso } from "@/lib/days";
import { botHolidayFeed } from "@/lib/holidays";
import { listSurgeons } from "@/lib/surgeon-store";
import { removeSurgeon, saveSurgeon } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "จัดการรายชื่อแพทย์ · ORSKH.APP" };

/** The admin page: whether the holiday calendar is connected, and the surgeon list, saved to the database. */
export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Anyone else gets the same page as a mistyped address.
  if (!isAdmin(session.user.id)) notFound();

  const today = todayIso();
  const [surgeons, holidays] = await Promise.all([listSurgeons(), botHolidayFeed(Number(today.slice(0, 4)))]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AdminBar
        title="จัดการรายชื่อแพทย์"
        name={session.user.physicianName || session.user.name || "ผู้ใช้ LINE"}
        image={session.user.image}
      />
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:gap-5">
          <HolidayStatus feed={holidays} today={today} />
          <PhysicianAdmin initial={surgeons} onSave={saveSurgeon} onRemove={removeSurgeon} />
        </div>
      </main>
    </div>
  );
}
