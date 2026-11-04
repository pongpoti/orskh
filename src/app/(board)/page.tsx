import { SuiteBoard, type CaseAdding } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { withAddedCases } from "@/lib/added-cases";
import { isAdmin } from "@/lib/admin";
import { profileFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { doctorFor, listCasesBy, listCasesOn } from "@/lib/cases";
import { db } from "@/lib/db";
import { todayIso } from "@/lib/days";
import { holidayOn } from "@/lib/holidays";
import { formatPhone } from "@/lib/phone";
import { fullName } from "@/lib/user-list";
import { boardFor, type DayBoard } from "@/lib/week";
import { addCase, deleteCase } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The day's board with the doctors' added cases, and the add-case form for a doctor. A database problem leaves the
 * imported cases on the board (with a notice) and hides the form.
 */
async function withCases(board: DayBoard | null, phone: string, today: string) {
  try {
    const pool = await db();
    const [doctor, added] = await Promise.all([doctorFor(pool, phone), board ? listCasesOn(pool, board.date) : []]);
    const adding: CaseAdding | null = doctor
      ? {
          doctor: { name: fullName(doctor), subtype: doctor.subtype },
          today,
          mine: await listCasesBy(pool, doctor.id, today),
          onAdd: addCase,
          onRemove: deleteCase,
        }
      : null;
    return { board: board ? withAddedCases(board, added) : null, adding, failed: false };
  } catch (error) {
    console.error("[board] added cases unavailable:", (error as Error).message);
    return { board, adding: null, failed: true };
  }
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayIso();
  // The full name of the user the number has claimed, read on every request (a corrected name shows without signing out).
  const [profile, holiday] = await Promise.all([
    profileFor(user.phone, user.name),
    // On a Thai public or special holiday the suite runs no list, so the plan shows no allocation.
    holidayOn(today),
  ]);
  const { board, adding, failed } = await withCases(holiday ? null : boardFor(today), user.phone, today);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar
        date={today}
        name={profile.name}
        role={profile.role}
        phone={formatPhone(user.phone)}
        image={user.picture}
        // Admins are listed by LINE user id (AUTH_ADMIN_LINE_IDS), the session's sub.
        adminHref={isAdmin(user.sub) ? "/admin" : null}
      />
      <SuiteBoard
        board={board}
        holiday={holiday?.name}
        roomId={params.room ?? null}
        adding={adding}
        casesUnavailable={failed && board !== null}
      />
    </div>
  );
}
