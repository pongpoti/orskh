"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FloorPlan, UNALLOCATED_FILL } from "@/components/floor-plan";
import { allocationFor, readableTextOn, type Department } from "@/lib/allocation";
import { boardHref } from "@/lib/days";
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

/** Whether a popover (the account menu) is open. False where the Popover API is missing, since nothing can be open. */
function isPopoverOpen(): boolean {
  try {
    return document.querySelector(":popover-open") !== null;
  } catch {
    return false;
  }
}

function Owner({ dept, part }: { dept: Department | null; part?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {part ? <span className="text-sm font-semibold text-ink-2">{part}</span> : null}
      {dept ? (
        <span className="chip chip-lg" style={{ "--chip": dept.color, color: readableTextOn(dept.color) } as CSSProperties}>
          {dept.name}
        </span>
      ) : (
        <span className="chip chip-lg" style={{ "--chip": UNALLOCATED_FILL, color: readableTextOn(UNALLOCATED_FILL) } as CSSProperties}>
          ไม่จัดสรร
        </span>
      )}
    </span>
  );
}

export function SuiteBoard({
  board,
  holiday = null,
  roomId = null,
  pathname = "/",
}: {
  /** Today's cases, or null when the suite is closed (the weekend or a holiday). */
  board: DayBoard | null;
  /** The name of today's Thai public or special holiday, if it is one. */
  holiday?: string | null;
  roomId?: string | null;
  pathname?: string;
}) {
  const router = useRouter();
  const found = getRoom(roomId);
  const urlRoom = found && isSelectableRoom(found) ? found.id : null;
  const [selectedId, setSelectedId] = useState<string | null>(urlRoom);
  const [prevUrl, setPrevUrl] = useState(urlRoom);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const menuWasOpen = useRef(false);

  if (prevUrl !== urlRoom) {
    setPrevUrl(urlRoom);
    setSelectedId(urlRoom);
  }

  const operations = board?.operations ?? NONE;
  const room = getRoom(selectedId);
  const open = room !== null;

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
    if (id) {
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
      if (event.key !== "Escape") return;
      // Escape belongs to an open popover (the account menu) first.
      if (isPopoverOpen()) return;
      choose(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onSelect(id: string) {
    choose(selectedId === id ? null : id);
  }

  // The board's own date decides who holds each room (it matches the cases). When the suite is closed
  // (the weekend or a holiday) no one does, so every room keeps the plain colour.
  const planDate = board?.date ?? null;
  const cases = room ? casesForRoom(operations, room.id) : [];
  const allocation = room && planDate ? allocationFor(room.id, planDate) : null;
  const wash = allocation?.am?.color ?? allocation?.pm?.color;

  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative mx-auto flex min-h-0 w-full max-w-[120rem] flex-1 flex-col overflow-hidden sm:px-3 lg:flex-row lg:gap-6 lg:px-6 lg:pt-3 lg:pb-4">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {board === null ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pt-3 pb-1 lg:px-0 lg:pt-0 lg:pb-3">
              <p className="pill px-4">{holiday ? `วันหยุด ${holiday} · ไม่มีตารางผ่าตัด` : "วันนี้เป็นวันหยุด ไม่มีตารางผ่าตัด"}</p>
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 justify-center overflow-hidden p-1 lg:p-0">
            <FloorPlan selectedId={selectedId} marks={marks} cases={counts} date={planDate} onSelect={onSelect} />
          </div>
        </div>

        {open ? (
          <button
            type="button"
            className="scrim fixed inset-0 z-10 cursor-default bg-[rgb(36_28_22/0.25)] lg:hidden"
            aria-label="ปิดรายการห้อง"
            onPointerDown={() => {
              // A tap outside the account menu closes the menu; it should not also close the room.
              // The menu is already gone by the time the click fires, so note it now.
              menuWasOpen.current = isPopoverOpen();
            }}
            onClick={() => {
              if (menuWasOpen.current) {
                menuWasOpen.current = false;
                return;
              }
              choose(null);
            }}
          />
        ) : null}

        <aside
          aria-label="รายการผ่าตัดของห้อง"
          className={`room-sheet z-20 flex min-h-0 flex-col overflow-hidden max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[60dvh] max-lg:rounded-t-[24px] lg:static lg:h-full lg:w-[26rem] lg:shrink-0 xl:w-[30rem] 2xl:w-[34rem] ${open ? "is-open" : "max-lg:pointer-events-none"}`}
        >
          {open ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="sheet-head shrink-0 border-b border-line" style={wash ? ({ "--wash": wash } as CSSProperties) : undefined}>
                <span aria-hidden className="mx-auto mt-2 block h-1 w-10 rounded-full bg-line-strong lg:hidden" />
                <div className="flex items-start justify-between gap-3 px-5 pt-1.5 pb-3.5 lg:pt-4">
                  <div className="min-w-0">
                    <div className="flex min-h-11 items-center gap-2.5">
                      <h2 ref={headingRef} tabIndex={-1} className="text-xl leading-snug font-bold text-ink outline-none">
                        {room ? roomLabel(room) : null}
                      </h2>
                      <span className="count-tag">
                        <span className="tabular-nums">{cases.length}</span> รายการ
                      </span>
                    </div>
                    {allocation ? (
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
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
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost size-11 min-h-0 shrink-0 rounded-full p-0 lg:hidden"
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
                <ol className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
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
                        <p className="text-sm text-muted">{item.surgeon}</p>
                        {item.shift === "out" ? (
                          <p className="mt-1.5">
                            <span className="badge badge-warning">นอกเวลา</span>
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
              <span aria-hidden className="flex size-11 items-center justify-center rounded-full bg-brand-tint text-brand">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 3l14 7-6 2.2L10.8 19z" />
                </svg>
              </span>
              <p className="text-sm font-medium text-muted">เลือกห้องบนแปลนเพื่อดูรายการวันนี้</p>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
