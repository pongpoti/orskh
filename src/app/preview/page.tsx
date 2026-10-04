import { notFound } from "next/navigation";
import { SuiteBoard } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { bangkokToday } from "@/lib/dates";
import { getRoom } from "@/lib/rooms";
import { getSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();

  const params = await searchParams;
  const today = bangkokToday();
  const room = getRoom(params.room);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar
        name="สมหญิง ไลน์"
        image="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='32' fill='%23c9e4dd'/%3E%3Ccircle cx='32' cy='26' r='10' fill='%231f4d46'/%3E%3Cpath d='M14 54c3-10 10-14 18-14s15 4 18 14' fill='%231f4d46'/%3E%3C/svg%3E"
        today={today}
        pathname="/preview"
        showAccount={false}
      />
      <SuiteBoard
        date={today}
        roomId={room?.id ?? null}
        operations={getSchedule(today)}
        pathname="/preview"
      />
    </div>
  );
}
