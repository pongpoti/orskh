"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { FloorPlan } from "@/components/floor-plan";
import { allocationFor, type Department } from "@/lib/allocation";
import { DayBar } from "@/components/day-bar";
import { boardHref, DAY_KEYS, UNPLACED_ID } from "@/lib/days";
import { getRoom, isSelectableRoom, roomLabel } from "@/lib/rooms";
import { casesForRoom, roomMark, type CaseStatus } from "@/lib/schedule";
import type { DayBoard } from "@/lib/week";

const STATUS_LABEL: Record<CaseStatus, string> = {
  scheduled: "รอ",
  "in-progress": "กำลังผ่าตัด",
  delayed: "เลื่อน",
  done: "เสร็จ",
  cancelled: "ยกเลิก",
  recovery: "พักฟื้น",
};

/** 16px glyphs inside a circle; each status has its own so colour is never the only cue. */
const STATUS_ICON: Record<CaseStatus, ReactNode> = {
  scheduled: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.9V8l2.2 1.4" />
    </>
  ),
  "in-progress": (
    <>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none" />
    </>
  ),
  delayed: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.5 5.6v4.8M9.5 5.6v4.8" />
    </>
  ),
  done: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M5.4 8.2l1.8 1.8 3.4-3.6" />
    </>
  ),
  cancelled: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" />
    </>
  ),
  recovery: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5.2v5.6M5.2 8h5.6" />
    </>
  ),
};

function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {STATUS_ICON[status]}
      </svg>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Owner({ dept, part }: { dept: Department | null; part?: string }) {
  return (
    <span className="flex items-center gap-2">
      {part ? <span className="w-8 shrink-0 text-muted">{part}</span> : null}
      {dept ? (
        <>
          <span aria-hidden className="size-3.5 shrink-0 rounded ring-1 ring-ink/30" style={{ background: `linear-gradient(135deg, ${dept.gradient[0]}, ${dept.gradient[1]})` }} />
          {dept.name}
        </>
      ) : (
        <span className="text-muted">ไม่จัดสรร</span>
      )}
    </span>
  );
}

/** Horizontal travel, in px, that counts as a swipe. */
const SWIPE_DISTANCE = 56;

export function SuiteBoard({
  week,
  dayIndex = 0,
  roomId = null,
  pathname = "/",
}: {
  week: DayBoard[];
  dayIndex?: number;
  roomId?: string | null;
  pathname?: string;
}) {
  const router = useRouter();
  const urlDay = Math.min(Math.max(dayIndex, 0), week.length - 1);
  const urlRoom = roomId === UNPLACED_ID ? UNPLACED_ID : (() => {
    const found = getRoom(roomId);
    return found && isSelectableRoom(found) ? found.id : null;
  })();
  const [day, setDay] = useState(urlDay);
  const [selectedId, setSelectedId] = useState<string | null>(urlRoom);
  const [prevUrl, setPrevUrl] = useState(`${urlDay}|${urlRoom}`);
  const [slide, setSlide] = useState<"next" | "prev" | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  if (prevUrl !== `${urlDay}|${urlRoom}`) {
    setPrevUrl(`${urlDay}|${urlRoom}`);
    setDay(urlDay);
    setSelectedId(urlRoom);
  }

  const board = week[day];
  const unplacedSelected = selectedId === UNPLACED_ID;
  const room = unplacedSelected ? null : getRoom(selectedId);
  const open = unplacedSelected || room !== null;

  const marks = useMemo(() => {
    const next: Record<string, ReturnType<typeof roomMark>> = {};
    for (const item of board.operations) {
      if (next[item.roomId]) continue;
      const target = getRoom(item.roomId);
      if (!target || !isSelectableRoom(target)) continue;
      next[item.roomId] = roomMark(casesForRoom(board.operations, item.roomId));
    }
    return next;
  }, [board]);

  function go(nextDay: number, nextRoom: string | null = selectedId) {
    const clamped = Math.min(Math.max(nextDay, 0), week.length - 1);
    if (clamped !== day) setSlide(clamped > day ? "next" : "prev");
    setDay(clamped);
    setSelectedId(nextRoom);
    startTransition(() => {
      router.replace(boardHref(DAY_KEYS[clamped], nextRoom, pathname), { scroll: false });
    });
  }

  function choose(id: string | null) {
    if (id && id !== UNPLACED_ID) {
      const next = getRoom(id);
      if (!next || !isSelectableRoom(next)) return;
    }
    go(day, id);
  }

  useEffect(() => {
    if (open) headingRef.current?.focus({ preventScroll: true });
  }, [open, selectedId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        go(day, null);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, select, textarea, [contenteditable='true']")) return;
      go(day + (event.key === "ArrowRight" ? 1 : -1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onSelect(id: string) {
    choose(selectedId === id ? null : id);
  }

  function onTouchStart(event: TouchEvent) {
    // The card scrolls and has its own controls; only the plan and its backdrop swipe between days.
    const point = event.touches.length === 1 && !(event.target as HTMLElement).closest("aside") ? event.touches[0] : null;
    touch.current = point ? { x: point.clientX, y: point.clientY } : null;
  }

  function onTouchEnd(event: TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start || (window.visualViewport?.scale ?? 1) > 1.05) return; // a zoomed-in drag pans, it does not change day
    const point = event.changedTouches[0];
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(day + (dx < 0 ? 1 : -1));
  }

  const cases = unplacedSelected ? board.unplaced : room ? casesForRoom(board.operations, room.id) : [];
  const allocation = room ? allocationFor(room.id, board.date) : null;

  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <DayBar index={day} onChange={(next) => go(next)} />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {board.unplaced.length > 0 ? (
          <button
            type="button"
            aria-pressed={unplacedSelected}
            onClick={() => onSelect(UNPLACED_ID)}
            className="btn btn-secondary absolute top-3 left-3 z-10 min-h-10 gap-1.5 px-3 text-sm"
          >
            ไม่ระบุห้อง
            <span className="rounded-full bg-brand-tint px-2 text-xs font-bold text-brand tabular-nums">{board.unplaced.length}</span>
          </button>
        ) : null}
        <div key={day} className={`flex min-h-0 flex-1 justify-center overflow-hidden p-3 ${slide ? `day-slide-${slide}` : ""}`}>
          <FloorPlan selectedId={unplacedSelected ? null : selectedId} marks={marks} date={board.date} onSelect={onSelect} />
        </div>
      </div>

      {open ? (
        <button
          type="button"
          className="scrim fixed inset-0 z-10 cursor-default bg-ink/50 lg:hidden"
          aria-label="ปิดรายการห้อง"
          onClick={() => choose(null)}
        />
      ) : null}

      <aside
        aria-label="รายการผ่าตัดของห้อง"
        className={`room-sheet z-20 flex min-h-0 flex-col max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[50dvh] max-lg:rounded-t-[1.25rem] lg:static lg:h-full lg:w-96 lg:shrink-0 ${open ? "is-open" : "max-lg:pointer-events-none"}`}
      >
        {open ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <span aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong lg:hidden" />
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 pt-2 pb-3.5 lg:py-4">
              <div className="min-w-0">
                <h2 ref={headingRef} tabIndex={-1} className="text-xl leading-tight font-bold text-ink outline-none">
                  {room ? roomLabel(room) : "ไม่ระบุห้อง"}
                </h2>
                {allocation ? (
                  <div className="mt-1 space-y-0.5 text-sm font-medium text-ink-2">
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
                  <p className="mt-1 text-sm text-ink-2">ไม่มีห้องตามตารางจัดสรรของวันนี้ และไฟล์ไม่ระบุห้อง</p>
                ) : null}
                <p className="mt-0.5 text-sm text-muted">{cases.length} รายการ</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary size-11 min-h-0 shrink-0 p-0 lg:hidden"
                aria-label="ปิด"
                title="ปิด"
                onClick={() => choose(null)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {cases.length === 0 ? (
              <p className="px-5 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-sm text-muted">ไม่มีรายการในวันนี้</p>
            ) : (
              <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
                {cases.map((item) => (
                  <li key={item.id} data-status={item.status} className="case-row">
                    <div className="flex items-center justify-between gap-3">
                      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                        <span className="tabular-nums">ลำดับ {item.order}</span>
                        {item.shift === "out" ? (
                          <span className="rounded bg-late-tint px-1.5 py-0.5 text-xs font-semibold text-late">นอกเวลา</span>
                        ) : null}
                      </p>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className={`mt-1.5 font-semibold ${item.status === "cancelled" ? "text-muted line-through" : "text-ink"}`}>
                      {item.procedure}
                    </p>
                    <p className="text-sm text-muted">{item.specialty ? `${item.surgeon} · ${item.specialty}` : item.surgeon}</p>
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
