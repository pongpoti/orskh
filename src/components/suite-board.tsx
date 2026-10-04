"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { FloorPlan } from "@/components/floor-plan";
import { boardHref } from "@/lib/dates";
import { getRoom, roomLabel } from "@/lib/rooms";
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
  scheduled: "bg-slate-100/80 text-slate-700",
  "in-progress": "bg-[#d7efe8]/80 text-label",
  delayed: "bg-amber-100/80 text-amber-950",
  done: "bg-slate-100/80 text-slate-500",
  cancelled: "bg-slate-100/80 text-slate-400",
  recovery: "bg-[#efe8fb]/80 text-[#4c3d73]",
};

const STATUS_BORDER: Record<CaseStatus, string> = {
  scheduled: "border-or",
  "in-progress": "border-active",
  delayed: "border-delayed",
  done: "border-ink/20",
  cancelled: "border-transparent",
  recovery: "border-[#8b74c9]",
};

export function SuiteBoard({
  date,
  operations,
  pathname = "/",
}: {
  date: string;
  operations: Operation[];
  pathname?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const urlRoomId = getRoom(params.get("room"))?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(urlRoomId);
  const [prevUrlRoomId, setPrevUrlRoomId] = useState(urlRoomId);
  const room = getRoom(selectedId);
  const headingRef = useRef<HTMLHeadingElement>(null);

  if (urlRoomId !== prevUrlRoomId) {
    setPrevUrlRoomId(urlRoomId);
    setSelectedId(urlRoomId);
  }

  const marks = useMemo(() => {
    const next: Record<string, ReturnType<typeof roomMark>> = {};
    for (const item of operations) {
      if (next[item.roomId]) continue;
      next[item.roomId] = roomMark(casesForRoom(operations, item.roomId));
    }
    return next;
  }, [operations]);

  function choose(id: string | null) {
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full touch-none justify-center overflow-hidden p-3">
          <FloorPlan selectedId={selectedId} marks={marks} onSelect={onSelect} />
        </div>
      </div>

      {room ? (
        <button
          type="button"
          className="fixed inset-0 z-10 bg-ink/20 backdrop-blur-[2px] lg:hidden"
          aria-label="ปิดรายการห้อง"
          onClick={() => choose(null)}
        />
      ) : null}

      <aside
        className={`room-sheet glass z-20 flex min-h-0 flex-col max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[62dvh] max-lg:rounded-t-3xl max-lg:border-t max-lg:border-white/50 max-lg:shadow-[0_-8px_30px_rgba(34,49,58,0.12)] lg:static lg:h-full lg:w-96 lg:shrink-0 lg:border-l lg:border-white/40 ${room ? "is-open" : "max-lg:pointer-events-none"}`}
      >
        {room ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-ink/10 px-5 py-4">
              <div>
                <p className="text-xs tracking-wide text-muted uppercase">โซน {room.zone}</p>
                <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-label outline-none">
                  {roomLabel(room)}
                </h2>
                <p className="text-sm text-muted">{cases.length} รายการ</p>
              </div>
              <button
                type="button"
                className="rounded-full border border-ink/15 bg-white/50 px-3 py-1 text-sm lg:hidden"
                onClick={() => choose(null)}
              >
                ปิด
              </button>
            </div>
            {cases.length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted">ไม่มีรายการในวันนี้</p>
            ) : (
              <ol className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
                {cases.map((item) => (
                  <li key={item.id} className={`border-l-4 pl-3 ${STATUS_BORDER[item.status]} ${item.status === "cancelled" ? "opacity-60" : ""}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium tabular-nums">{item.start}–{item.end}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[item.status]}`}>
                        {STATUS_LABEL[item.status]}
                      </span>
                    </div>
                    <p className={`mt-1 font-medium ${item.status === "cancelled" ? "line-through" : ""}`}>{item.procedure}</p>
                    <p className="text-sm text-muted">{item.surgeon}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <div className="hidden h-full flex-col justify-center px-6 lg:flex">
            <p className="font-medium">เลือกห้องบนแปลน</p>
            <p className="mt-1 text-sm text-muted">ห้องผ่าตัด 1–13 และห้องพักฟื้นแสดงรายการของวันนั้น</p>
          </div>
        )}
      </aside>
    </div>
  );
}
