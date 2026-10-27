import { thaiDate } from "@/lib/days";

/** Today's date, large, over the plan. The board shows one day only, so there is nothing to page through. */
export function DateBar({ date, closed }: { date: string; closed: boolean }) {
  return (
    <div className="shrink-0 px-3 pt-3 sm:px-6 sm:pt-4">
      <div className="glass mx-auto flex max-w-[90rem] items-center justify-between gap-3 rounded-[var(--radius)] px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-muted">ตารางผ่าตัดวันนี้</p>
          <h1 className="truncate text-lg leading-7 font-bold tracking-[-0.01em] text-ink sm:text-xl">
            <time dateTime={date}>{thaiDate(date)}</time>
          </h1>
        </div>
        {closed ? <span className="badge badge-muted">วันหยุด</span> : null}
      </div>
    </div>
  );
}
