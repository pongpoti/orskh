"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FloorPlan } from "@/components/floor-plan";
import { allocationFor, type Department } from "@/lib/allocation";
import { boardHref } from "@/lib/dates";
import { getRoom, isSelectableRoom, roomLabel } from "@/lib/rooms";
import { casesForRoom, roomMark, type CaseStatus, type Operation } from "@/lib/schedule";

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

export function SuiteBoard({
  date,
  roomId = null,
  operations,
  pathname = "/",
}: {
  date: string;
  roomId?: string | null;
  operations: Operation[];
  pathname?: string;
}) {
  const router = useRouter();
  const initialRoom = getRoom(roomId);
  const initialRoomId = initialRoom && isSelectableRoom(initialRoom) ? initialRoom.id : null;
  const [selectedId, setSelectedId] = useState<string | null>(initialRoomId);
  const [prevRoomId, setPrevRoomId] = useState(initialRoomId);
  const room = getRoom(selectedId);
  const headingRef = useRef<HTMLHeadingElement>(null);

  if (initialRoomId !== prevRoomId) {
    setPrevRoomId(initialRoomId);
    setSelectedId(initialRoomId);
  }

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
      router.replace(boardHref(date, id, pathname), { scroll: false });
    });
  }

  useEffect(() => {
    if (room) headingRef.current?.focus({ preventScroll: true });
  }, [room]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setSelectedId(null);
      startTransition(() => {
        router.replace(boardHref(date, null, pathname), { scroll: false });
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [date, pathname, router]);

  function onSelect(id: string) {
    choose(selectedId === id ? null : id);
  }

  const cases = room ? casesForRoom(operations, room.id) : [];
  const allocation = room ? allocationFor(room.id, date) : null;

  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 justify-center overflow-hidden p-3">
          <FloorPlan selectedId={selectedId} marks={marks} date={date} onSelect={onSelect} />
        </div>
      </div>

      {room ? (
        <button
          type="button"
          className="scrim fixed inset-0 z-10 cursor-default bg-ink/50 lg:hidden"
          aria-label="ปิดรายการห้อง"
          onClick={() => choose(null)}
        />
      ) : null}

      <aside
        aria-label="รายการผ่าตัดของห้อง"
        className={`room-sheet z-20 flex min-h-0 flex-col max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[50dvh] max-lg:rounded-t-[1.25rem] lg:static lg:h-full lg:w-96 lg:shrink-0 ${room ? "is-open" : "max-lg:pointer-events-none"}`}
      >
        {room ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <span aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong lg:hidden" />
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 pt-2 pb-3.5 lg:py-4">
              <div className="min-w-0">
                <h2 ref={headingRef} tabIndex={-1} className="text-xl leading-tight font-bold text-ink outline-none">
                  {roomLabel(room)}
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
                      <p className="text-sm font-semibold text-ink tabular-nums">
                        {item.start}–{item.end}
                      </p>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className={`mt-1.5 font-semibold ${item.status === "cancelled" ? "text-muted line-through" : "text-ink"}`}>
                      {item.procedure}
                    </p>
                    <p className="text-sm text-muted">{item.surgeon}</p>
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
    </main>
  );
}
