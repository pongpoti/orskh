import { auth } from "@/auth";
import { SuiteBoard } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { bangkokToday, formatBangkokTime } from "@/lib/dates";
import { getRoom } from "@/lib/rooms";
import { getSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const params = await searchParams;
  const today = bangkokToday();
  const room = getRoom(params.room);
  const session = await auth();

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar
        name={session?.user?.name || "ผู้ใช้ LINE"}
        image={session?.user?.image}
        detail={
          [session?.user?.physicianName, session?.user?.specialty].filter(Boolean).join(" · ") || undefined
        }
        today={today}
        updatedAt={formatBangkokTime()}
      />
      <SuiteBoard date={today} roomId={room?.id ?? null} operations={getSchedule(today)} />
    </div>
  );
}
