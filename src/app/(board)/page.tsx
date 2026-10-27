import { auth } from "@/auth";
import { SuiteBoard } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { todayIso } from "@/lib/days";
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

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar name={session?.user?.physicianName || session?.user?.name || "ผู้ใช้ LINE"} image={session?.user?.image} />
      <SuiteBoard board={boardFor(today)} today={today} roomId={params.room ?? null} />
    </div>
  );
}
