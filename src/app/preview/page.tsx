import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SuiteBoard } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { bangkokToday, formatBangkokTime, parseBoardDate } from "@/lib/dates";
import { getRoom } from "@/lib/rooms";
import { getSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; room?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();

  const params = await searchParams;
  const today = bangkokToday();
  const date = parseBoardDate(params.date);
  const room = getRoom(params.room);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar
        name="โหมดตัวอย่าง"
        date={date}
        today={today}
        roomId={room?.id ?? null}
        updatedAt={formatBangkokTime()}
        pathname="/preview"
        showAccount={false}
      />
      <Suspense fallback={<div className="flex-1 bg-floor" />}>
        <SuiteBoard date={date} operations={getSchedule(date)} pathname="/preview" />
      </Suspense>
    </div>
  );
}
