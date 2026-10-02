"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
  scheduled: "bg-slate-100 text-slate-700",
  "in-progress": "bg-[#d7efe8] text-label",
  delayed: "bg-amber-100 text-amber-950",
  done: "bg-slate-100 text-slate-500",
  cancelled: "bg-slate-100 text-slate-400",
  recovery: "bg-[#efe8fb] text-[#4c3d73]",
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
  const roomId = getRoom(params.get("room"))?.id ?? null;
  const room = getRoom(roomId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [scale, setScale] = useState(1);

  const marks = useMemo(() => {
    const next: Record<string, ReturnType<typeof roomMark>> = {};
    for (const item of operations) {
      next[item.roomId] = roomMark(operations.filter((op) => op.roomId === item.roomId));
    }
    return next;
  }, [operations]);

  function choose(id: string | null) {
    router.replace(boardHref(date, id, pathname), { scroll: false });
  }

  useEffect(() => {
    if (room) headingRef.current?.focus();
  }, [room]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        router.replace(boardHref(date, null, pathname), { scroll: false });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [date, pathname, router]);

  function onSelect(id: string) {
    choose(roomId === id ? null : id);
  }

  const cases = room ? casesForRoom(operations, room.id) : [];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="relative min-h-0 flex-1">
        <div className="absolute top-3 right-3 z-10 flex gap-1">
          <ZoomButton label="ย่อ" onClick={() => setScale((value) => clamp(value - 0.2))}>−</ZoomButton>
          <ZoomButton label="ขนาดพอดี" onClick={() => setScale(1)}>พอดี</ZoomButton>
          <ZoomButton label="ขยาย" onClick={() => setScale((value) => clamp(value + 0.2))}>+</ZoomButton>
        </div>
        <div className="flex h-full justify-center overflow-auto p-3">
          <div style={{ height: `${scale * 100}%` }} className="shrink-0">
            <FloorPlan selectedId={roomId} marks={marks} onSelect={onSelect} />
          </div>
        </div>
      </div>

      {room ? (
        <button
          type="button"
          className="fixed inset-0 z-10 bg-ink/30 lg:hidden"
          aria-label="ปิดรายการห้อง"
          onClick={() => choose(null)}
        />
      ) : null}

      <aside
        className={`room-sheet z-20 flex min-h-0 flex-col bg-white max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[62dvh] max-lg:rounded-t-3xl max-lg:shadow-[0_-8px_30px_rgba(34,49,58,0.12)] max-lg:transition-transform lg:static lg:h-full lg:w-96 lg:shrink-0 lg:translate-y-0 lg:border-l lg:border-ink/10 ${room ? "max-lg:translate-y-0" : "max-lg:translate-y-full"}`}
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
                className="rounded-full border border-ink/15 px-3 py-1 text-sm lg:hidden"
                onClick={() => choose(null)}
              >
                ปิด
              </button>
            </div>
            {cases.length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted">ไม่มีรายการในวันนี้</p>
            ) : (
              <ol className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
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

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded-full border border-ink/10 bg-white px-3 py-1 text-sm shadow-sm hover:bg-floor"
    >
      {children}
    </button>
  );
}

function clamp(value: number): number {
  return Math.min(2.4, Math.max(0.7, Number(value.toFixed(2))));
}
