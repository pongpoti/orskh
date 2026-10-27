import { auth } from "@/auth";
import { SuiteBoard } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { todayIso } from "@/lib/days";
import { holidayOn } from "@/lib/holidays";
import { boardFor } from "@/lib/week";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  const today = todayIso();
  // On a Thai public or special holiday the suite runs no list, so the plan shows no allocation.
  const holiday = await holidayOn(today);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar date={today} name={session?.user?.physicianName || session?.user?.name || "ผู้ใช้ LINE"} image={session?.user?.image} />
      <SuiteBoard board={holiday ? null : boardFor(today)} holiday={holiday?.name} roomId={params.room ?? null} />
    </div>
  );
}
