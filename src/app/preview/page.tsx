import { notFound } from "next/navigation";
import { SuiteBoard } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { parseDay, todayIso, workdayIndex } from "@/lib/days";
import { holidayOn } from "@/lib/holidays";
import { boardFor } from "@/lib/week";

export const dynamic = "force-dynamic";

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; day?: string; holiday?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();

  const params = await searchParams;
  const today = todayIso();
  // Development only: ?day=tue shows that weekday's cases, to check a weekday from the weekend.
  const index = parseDay(params.day) ?? workdayIndex(today);
  // ?holiday=วันปิยมหาราช shows the board as on a holiday; otherwise today's real holiday, if any, applies.
  const holiday = params.holiday?.trim() || (params.day ? null : (await holidayOn(today))?.name) || null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar
        date={today}
        name="สมหญิง ไลน์"
        image="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='32' fill='%23eadcc8'/%3E%3Ccircle cx='32' cy='26' r='10' fill='%233f2f24'/%3E%3Cpath d='M14 54c3-10 10-14 18-14s15 4 18 14' fill='%233f2f24'/%3E%3C/svg%3E"
        pathname="/preview"
        showAccount={false}
      />
      <SuiteBoard board={holiday ? null : boardFor(today, index)} holiday={holiday} roomId={params.room ?? null} pathname="/preview" />
    </div>
  );
}
