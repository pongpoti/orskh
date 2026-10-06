import { auth } from "@/auth";
import { SuiteBoard } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { parseDay } from "@/lib/days";
import { weekBoard } from "@/lib/week";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; day?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar name={session?.user?.physicianName || session?.user?.name || "ผู้ใช้ LINE"} image={session?.user?.image} />
      <SuiteBoard week={weekBoard()} dayIndex={parseDay(params.day)} roomId={params.room ?? null} />
    </div>
  );
}
