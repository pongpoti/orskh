import { notFound } from "next/navigation";
import { AdminBar } from "@/components/admin-bar";
import { HolidayStatus } from "@/components/holiday-status";
import { PhysicianAdmin } from "@/components/physician-admin";
import { SURGEONS } from "@/data/surgeons";
import { todayIso } from "@/lib/days";
import type { HolidayFeed } from "@/lib/holidays";

export const dynamic = "force-dynamic";

const SAMPLE_FEEDS: Record<string, HolidayFeed> = {
  ok: {
    state: "ok",
    holidays: [
      { date: "2026-10-23", name: "วันปิยมหาราช" },
      { date: "2026-12-07", name: "ชดเชยวันคล้ายวันพระบรมราชสมภพของพระบาทสมเด็จพระบรมชนกาธิเบศร มหาภูมิพลอดุลยเดชมหาราช บรมนาถบพิตร วันชาติ และวันพ่อแห่งชาติ" },
      { date: "2026-12-10", name: "วันพระราชทานรัฐธรรมนูญ" },
      { date: "2026-12-31", name: "วันสิ้นปี" },
    ],
  },
  empty: { state: "ok", holidays: [] },
  "no-token": { state: "no-token" },
  refused: { state: "failed", status: 401 },
  unreachable: { state: "failed", status: null },
};

/**
 * Development only: the admin page with the supplied surgeons. Changes stay in the page and are not saved.
 * `?holidays=ok|empty|no-token|refused|unreachable` shows each state of the holiday calendar card.
 */
export default async function PreviewAdminPage({ searchParams }: { searchParams: Promise<{ holidays?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { holidays = "ok" } = await searchParams;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AdminBar title="จัดการรายชื่อแพทย์" name="สมหญิง ไลน์" boardHref="/preview" />
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:gap-5">
          <HolidayStatus feed={SAMPLE_FEEDS[holidays] ?? SAMPLE_FEEDS.ok} today={todayIso()} />
          <PhysicianAdmin initial={SURGEONS.map((person, index) => ({ id: index + 1, ...person }))} />
        </div>
      </main>
    </div>
  );
}
