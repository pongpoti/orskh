import { SuiteBoard } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { isAdmin } from "@/lib/admin";
import { displayNameFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { todayIso } from "@/lib/days";
import { holidayOn } from "@/lib/holidays";
import { formatPhone } from "@/lib/phone";
import { boardFor } from "@/lib/week";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayIso();
  // The full name from the physicians table, read on every request (a corrected name shows without signing out).
  const [name, holiday] = await Promise.all([
    displayNameFor(user.phone, user.name),
    // On a Thai public or special holiday the suite runs no list, so the plan shows no allocation.
    holidayOn(today),
  ]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar
        date={today}
        name={name}
        phone={formatPhone(user.phone)}
        image={user.picture}
        // Admins are listed by LINE user id (AUTH_ADMIN_LINE_IDS), the session's sub.
        adminHref={isAdmin(user.sub) ? "/admin" : null}
      />
      <SuiteBoard board={holiday ? null : boardFor(today)} holiday={holiday?.name} roomId={params.room ?? null} />
    </div>
  );
}
