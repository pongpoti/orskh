"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FloorPlan } from "@/components/floor-plan";
import { allocationFor, readableTextOn, type Department } from "@/lib/allocation";
import { DateBar } from "@/components/date-bar";
import { boardHref, UNPLACED_ID } from "@/lib/days";
import { getRoom, isSelectableRoom, roomLabel } from "@/lib/rooms";
import { casesForRoom, roomMark, type CaseStatus, type Operation } from "@/lib/schedule";
import type { DayBoard } from "@/lib/week";

const STATUS_LABEL: Record<CaseStatus, string> = {
  scheduled: "รอ",
  "in-progress": "กำลังผ่าตัด",
  delayed: "เลื่อน",
  done: "เสร็จ",
  cancelled: "ยกเลิก",
  recovery: "พักฟื้น",
};

const NONE: Operation[] = [];

function Owner({ dept, part }: { dept: Department | null; part?: string }) {
  return (
    <span className="flex items-center gap-2">
      {part ? <span className="w-8 shrink-0 text-muted">{part}</span> : null}
      {dept ? (
        <span className="chip" style={{ "--chip": dept.color, color: readableTextOn(dept.color) } as CSSProperties}>
          {dept.name}
        </span>
      ) : (
        <span className="chip text-muted">ไม่จัดสรร</span>
      )}
    </span>
  );
}

export function SuiteBoard({
  board,
  today,
  roomId = null,
  pathname = "/",
}: {
  /** Today's cases, or null when the suite is closed (the weekend). */
  board: DayBoard | null;
  /** Today's calendar date, YYYY-MM-DD. */
  today: string;
  roomId?: string | null;
  pathname?: string;
}) {
  const router = useRouter();
  const urlRoom = roomId === UNPLACED_ID ? UNPLACED_ID : (() => {
    const found = getRoom(roomId);
    return found && isSelectableRoom(found) ? found.id : null;
  })();
  const [selectedId, setSelectedId] = useState<string | null>(urlRoom);
  const [prevUrl, setPrevUrl] = useState(urlRoom);
  const headingRef = useRef<HTMLHeadingElement>(null);

  if (prevUrl !== urlRoom) {
    setPrevUrl(urlRoom);
    setSelectedId(urlRoom);
  }

  const operations = board?.operations ?? NONE;
  const unplaced = board?.unplaced ?? NONE;
  const unplacedSelected = selectedId === UNPLACED_ID;
  const room = unplacedSelected ? null : getRoom(selectedId);
  const open = unplacedSelected || room !== null;

  const counts = useMemo(() => {
    const next: Record<string, number> = {};
    for (const item of operations) next[item.roomId] = (next[item.roomId] ?? 0) + 1;
    return next;
  }, [operations]);

  const marks = useMemo(() => {
    const next: Record<string, ReturnType<typeof roomMark>> = {};
    for (const item of operations) {
      if (next[item.roomId]) continue;
      const target = getRoom(item.roomId);
      if (!target || !isSelectableRoom(target)) continue;
      next[item.roomId] = roomMark(casesForRoom(operations, item.roomId));
    }
    return next;
  }, [operations]);

  function choose(id: string | null) {
    if (id && id !== UNPLACED_ID) {
      const next = getRoom(id);
      if (!next || !isSelectableRoom(next)) return;
    }
    setSelectedId(id);
    startTransition(() => {
      router.replace(boardHref(id, pathname, window.location.search), { scroll: false });
    });
  }

  useEffect(() => {
    if (open) headingRef.current?.focus({ preventScroll: true });
  }, [open, selectedId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") choose(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onSelect(id: string) {
    choose(selectedId === id ? null : id);
  }

  // The board's own date decides who holds each room (it matches the cases); at the weekend no one does.
  const planDate = board?.date ?? today;
  const cases = unplacedSelected ? unplaced : room ? casesForRoom(operations, room.id) : [];
  const allocation = room ? allocationFor(room.id, planDate) : null;
  const wash = allocation?.am?.color ?? allocation?.pm?.color;

  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <DateBar date={today} closed={board === null} />
      <div className="relative mx-auto flex min-h-0 w-full max-w-[90rem] flex-1 flex-col overflow-hidden lg:flex-row lg:gap-4 sm:px-3 lg:px-6 lg:pt-3 lg:pb-4">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {unplaced.length > 0 ? (
            <button
              type="button"
              aria-pressed={unplacedSelected}
              onClick={() => onSelect(UNPLACED_ID)}
              className="btn btn-secondary absolute top-2 left-2 z-10 min-h-10 gap-1.5 px-3 text-sm aria-pressed:bg-[var(--tan-fill-hover)]"
            >
              ไม่มีห้องที่ถูกต้อง
              <span className="rounded-full bg-brand px-2 text-xs font-bold text-white tabular-nums">{unplaced.length}</span>
            </button>
          ) : null}
          {board === null ? (
            <p className="glass absolute top-2 right-2 left-2 z-10 rounded-xl px-4 py-2.5 text-center text-sm font-medium text-ink-2 sm:right-auto">
              วันนี้เป็นวันหยุด ไม่มีตารางผ่าตัด
            </p>
          ) : null}
          <div className="flex min-h-0 flex-1 justify-center overflow-hidden p-1 lg:p-2">
            <FloorPlan selectedId={unplacedSelected ? null : selectedId} marks={marks} cases={counts} date={planDate} onSelect={onSelect} />
          </div>
        </div>

        {open ? (
          <button
            type="button"
            className="scrim fixed inset-0 z-10 cursor-default bg-[rgb(36_28_22/0.35)] backdrop-blur-[2px] lg:hidden"
            aria-label="ปิดรายการห้อง"
            onClick={() => choose(null)}
          />
        ) : null}

        <aside
          aria-label="รายการผ่าตัดของห้อง"
          className={`room-sheet z-20 flex min-h-0 flex-col overflow-hidden max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[55dvh] max-lg:rounded-t-[20px] lg:static lg:h-full lg:w-96 lg:shrink-0 ${open ? "is-open" : "max-lg:pointer-events-none"}`}
        >
          {open ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="sheet-head shrink-0 border-b border-line" style={wash ? ({ "--wash": wash } as CSSProperties) : undefined}>
                <span aria-hidden className="mx-auto mt-2 block h-1 w-10 rounded-full bg-line-strong lg:hidden" />
                <div className="flex items-start justify-between gap-3 px-5 pt-2 pb-4 lg:pt-5">
                  <div className="min-w-0">
                    <h2 ref={headingRef} tabIndex={-1} className="text-xl leading-tight font-bold tracking-[-0.01em] text-ink outline-none">
                      {room ? roomLabel(room) : "ไม่มีห้องที่ถูกต้อง"}
                    </h2>
                    {allocation ? (
                      <div className="mt-2 space-y-1.5 text-sm">
                        {allocation.split ? (
                          <>
                            <Owner part="เช้า" dept={allocation.am} />
                            <Owner part="บ่าย" dept={allocation.pm} />
                          </>
                        ) : (
                          <Owner dept={allocation.am} />
                        )}
                      </div>
                    ) : null}
                    {unplacedSelected ? (
                      <p className="mt-1 text-sm text-ink-2">แผนกของเคสเหล่านี้ไม่มีห้องตามตารางจัดสรรของวันนี้</p>
                    ) : null}
                    <p className="mt-2 text-sm font-semibold text-muted">
                      <span className="text-ink tabular-nums">{cases.length}</span> รายการ
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost size-10 min-h-0 shrink-0 p-0 lg:hidden"
                    aria-label="ปิด"
                    title="ปิด"
                    onClick={() => choose(null)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              </div>
              {cases.length === 0 ? (
                <p className="px-5 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-center text-sm text-muted">ไม่มีรายการในวันนี้</p>
              ) : (
                <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
                  {cases.map((item) => (
                    <li key={item.id} data-status={item.status} className="case-row">
                      <span className="order-no mt-0.5">
                        <span className="sr-only">ลำดับ </span>
                        {item.order}
                      </span>
                      <div className="min-w-0">
                        <p className={`font-semibold ${item.status === "cancelled" ? "text-muted line-through" : "text-ink"}`}>
                          {item.procedure}
                          <span className="sr-only"> ({STATUS_LABEL[item.status]})</span>
                        </p>
                        <p className="text-sm text-muted">{item.specialty ? `${item.surgeon} · ${item.specialty}` : item.surgeon}</p>
                        {item.shift === "out" || unplacedSelected ? (
                          <p className="mt-1.5 flex flex-wrap gap-1.5">
                            {item.shift === "out" ? <span className="badge badge-warning">นอกเวลา</span> : null}
                            {unplacedSelected ? <span className="badge badge-warning">ไม่มีห้องที่ถูกต้อง</span> : null}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <div className="hidden flex-1 flex-col items-center justify-center gap-3 px-8 text-center lg:flex">
              <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-brand-tint text-brand">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 3l14 7-6 2.2L10.8 19z" />
                </svg>
              </span>
              <div>
                <p className="font-semibold text-ink">เลือกห้องบนแปลน</p>
                <p className="mt-1 text-sm text-muted">OR 1–13 แสดงรายการของวันนี้</p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
