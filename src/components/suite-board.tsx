"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { FloorPlan } from "@/components/floor-plan";
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

const STATUS_PILL: Record<CaseStatus, string> = {
  scheduled: "bg-slate-100 text-slate-700",
  "in-progress": "bg-[#d7efe8] text-label",
  delayed: "bg-amber-100 text-amber-950",
  done: "bg-slate-100 text-slate-600",
  cancelled: "bg-slate-100 text-slate-600",
  recovery: "bg-[#efe8fb] text-[#4c3d73]",
};

const STATUS_CARD: Record<CaseStatus, string> = {
  scheduled: "border-l-or bg-white/70",
  "in-progress": "border-l-active bg-[#eef8f5]",
  delayed: "border-l-delayed bg-amber-50/70",
  done: "border-l-ink/20 bg-white/50",
  cancelled: "border-l-ink/10 bg-white/50",
  recovery: "border-l-[#8b74c9] bg-[#f6f2fc]",
};

const LEGEND = [
  { label: "ห้องผ่าตัด", swatch: "bg-or ring-1 ring-ink/25" },
  { label: "พักฟื้น", swatch: "bg-recovery ring-1 ring-ink/25" },
  { label: "กำลังใช้งาน", swatch: "bg-active ring-2 ring-white" },
  { label: "มีเคสเลื่อน", swatch: "bg-delayed ring-2 ring-white" },
] as const;

function Legend({ className = "" }: { className?: string }) {
  return (
    <ul aria-label="สัญลักษณ์บนแปลน" className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted ${className}`}>
      {LEGEND.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className={`size-3 rounded-full ${item.swatch}`} />
          {item.label}
        </li>
      ))}
    </ul>
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
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);

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

  // Phones: tell the plan how much of the bottom the open sheet covers.
  useEffect(() => {
    const root = rootRef.current;
    const sheet = sheetRef.current;
    if (!root || !sheet) return;
    if (!room) {
      root.style.setProperty("--sheet-h", "0px");
      return;
    }
    const sync = () => root.style.setProperty("--sheet-h", `${sheet.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(sheet);
    return () => observer.disconnect();
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

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <Legend className="justify-center px-4 pt-2 lg:hidden" />
        <div className="plan-stage flex min-h-0 flex-1 justify-center overflow-hidden px-3 pt-3">
          <FloorPlan selectedId={selectedId} marks={marks} onSelect={onSelect} />
        </div>
      </div>

      {room ? (
        <button
          type="button"
          className="fixed inset-0 z-10 cursor-default bg-ink/10 lg:hidden"
          aria-label="ปิดรายการห้อง"
          onClick={() => choose(null)}
        />
      ) : null}

      <aside
        ref={sheetRef}
        className={`room-sheet glass z-20 flex min-h-0 flex-col max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[50dvh] max-lg:rounded-t-3xl max-lg:border-t max-lg:border-white/60 lg:static lg:h-full lg:w-96 lg:shrink-0 lg:border-l lg:border-ink/10 ${room ? "is-open" : "max-lg:pointer-events-none"}`}
      >
        {room ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <span aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-ink/15 lg:hidden" />
            <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-5 pt-2 pb-3 lg:py-4">
              <div>
                <h2 ref={headingRef} tabIndex={-1} className="text-xl leading-tight font-semibold text-label outline-none">
                  {roomLabel(room)}
                </h2>
                <p className="text-sm text-muted">{cases.length} รายการ</p>
              </div>
              <button type="button" className="btn btn-secondary min-h-10 px-4 lg:hidden" onClick={() => choose(null)}>
                ปิด
              </button>
            </div>
            {cases.length === 0 ? (
              <p className="px-5 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-sm text-muted">ไม่มีรายการในวันนี้</p>
            ) : (
              <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {cases.map((item) => {
                  const cancelled = item.status === "cancelled";
                  return (
                    <li key={item.id} className={`rounded-xl border border-l-4 border-ink/10 px-3 py-2.5 ${STATUS_CARD[item.status]}`}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium tabular-nums">{item.start}–{item.end}</p>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL[item.status]}`}>
                          {STATUS_LABEL[item.status]}
                        </span>
                      </div>
                      <p className={`mt-1 font-medium ${cancelled ? "text-muted line-through" : ""}`}>{item.procedure}</p>
                      <p className="text-sm text-muted">{item.surgeon}</p>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        ) : (
          <div className="hidden flex-1 flex-col items-center justify-center gap-3 px-8 text-center lg:flex">
            <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-or/60 text-label">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 3l14 7-6 2.2L10.8 19z" />
              </svg>
            </span>
            <div>
              <p className="font-medium">เลือกห้องบนแปลน</p>
              <p className="mt-1 text-sm text-muted">OR 1–13 แสดงรายการของวันนี้</p>
            </div>
          </div>
        )}
        <Legend className="hidden shrink-0 border-t border-ink/10 px-5 py-3 lg:flex" />
      </aside>
    </div>
  );
}
