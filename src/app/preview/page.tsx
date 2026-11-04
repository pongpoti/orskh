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
  searchParams: Promise<{ room?: string; day?: string; date?: string; holiday?: string; admin?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();

  const params = await searchParams;
  // ?date=2026-12-10 shows the board as on that date (e.g. the ventilation repair's layout); otherwise today.
  const today = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayIso();
  // Development only: ?day=tue shows that weekday's cases, to check a weekday from the weekend.
  const index = parseDay(params.day) ?? workdayIndex(today);
  // ?holiday=วันปิยมหาราช shows the board as on a holiday; otherwise today's real holiday, if any, applies.
  const holiday = params.holiday?.trim() || (params.day ? null : (await holidayOn(today))?.name) || null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar
        date={today}
        name="สมหญิง ไลน์"
        pathname="/preview"
        showAccount={false}
        // ?admin=1 shows the bar as an admin sees it.
        adminHref={params.admin ? "/preview/admin" : null}
      />
      <SuiteBoard
        board={holiday ? null : boardFor(today, index)}
        today={today}
        holiday={holiday}
        roomId={params.room ?? null}
        pathname="/preview"
      />
    </div>
  );
}
