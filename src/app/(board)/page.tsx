import { Suspense } from "react";
import { auth } from "@/auth";
import { SuiteBoard } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { bangkokToday, formatBangkokTime, parseBoardDate } from "@/lib/dates";
import { getRoom } from "@/lib/rooms";
import { getSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; room?: string }>;
}) {
  const params = await searchParams;
  const today = bangkokToday();
  const date = parseBoardDate(params.date);
  const room = getRoom(params.room);
  const session = await auth();

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar
        name={session?.user?.name || "ผู้ใช้ LINE"}
        date={date}
        today={today}
        roomId={room?.id ?? null}
        updatedAt={formatBangkokTime()}
      />
      <Suspense fallback={<div className="flex-1 bg-floor" />}>
        <SuiteBoard date={date} operations={getSchedule(date)} />
      </Suspense>
    </div>
  );
}
