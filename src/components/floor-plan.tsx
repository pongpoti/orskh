"use client";

import type { CSSProperties } from "react";
import { FloorScenery } from "@/components/floor-scenery";
import { allocationFor, allocationText, DEPARTMENTS, readableTextOn, type Department, type RoomAllocation } from "@/lib/allocation";
import { isSelectableRoom, roomBounds, roomLabel, ROOMS, type Room } from "@/lib/rooms";
import type { RoomMark } from "@/lib/schedule";

/** Weekday room that the schedule leaves unallocated. */
const UNALLOCATED_FILL = "#e8ecee";

const MARK_LABEL: Record<Exclude<RoomMark, null>, string> = {
  active: "กำลังใช้งาน",
  delayed: "มีเคสเลื่อน",
};

/** Gradient direction per department (x1, y1, x2, y2 on the room's bounding box), so neighbouring rooms do not look alike. */
const DIRECTIONS = [
  [0, 0, 1, 1],
  [0, 1, 1, 0],
  [0, 0, 0, 1],
  [0, 0, 1, 0],
] as const;
const DEPT_ORDER = Object.keys(DEPARTMENTS);

function floorFill(room: Room, allocation: RoomAllocation | null): string | undefined {
  if (!allocation) return undefined;
  if (allocation.split) return `url(#fp-split-${room.id})`;
  return allocation.am ? `url(#fp-grad-${allocation.am.code})` : UNALLOCATED_FILL;
}

/** Rough advance of a bold label glyph, in em: capitals are wide, lowercase and Thai are narrower. */
function advance(text: string): number {
  return /^[A-Z]+$/.test(text) ? 0.72 : 0.58;
}

/** Largest font size, up to `max`, at which `text` still fits `width`. */
function fitSize(text: string, width: number, max: number, min: number): number {
  return Math.max(min, Math.min(max, width / (advance(text) * text.length)));
}

function DeptText({
  x,
  y,
  dept,
  width,
  max,
  min,
}: {
  x: number;
  y: number;
  dept: Department | null;
  width: number;
  max: number;
  min: number;
}) {
  const text = dept ? dept.label : "ไม่จัดสรร";
  return (
    <text
      className="fp-dept"
      x={x}
      y={y}
      dy="0.35em"
      style={{ fontSize: fitSize(text, width, max, min), fill: dept ? readableTextOn(dept.color) : "var(--fp-muted)" }}
    >
      {text}
    </text>
  );
}

/** Room number in a white badge, with the owning department(s) beside it. */
function RoomLabel({ room, allocation }: { room: Room; allocation: RoomAllocation | null }) {
  const { minX, maxX, minY, maxY } = roomBounds(room);
  const { labelX: x, labelY: y } = room;
  const width = maxX - minX - 48;

  if (allocation?.split) {
    // Two bands (morning above, afternoon below) with the badge on the seam.
    const radius = 32;
    return (
      <>
        <DeptText x={x} y={(minY + (y - radius)) / 2} dept={allocation.am} width={width} max={30} min={22} />
        <DeptText x={x} y={(y + radius + maxY) / 2} dept={allocation.pm} width={width} max={30} min={22} />
        <circle className="fp-badge" cx={x} cy={y} r={radius} />
        <text className="fp-label" x={x} y={y} dy="0.35em" style={{ fontSize: 40 }}>
          {room.number}
        </text>
      </>
    );
  }

  const badgeY = allocation ? y - 32 : y;
  return (
    <>
      <circle className="fp-badge" cx={x} cy={badgeY} r={42} />
      <text className="fp-label" x={x} y={badgeY} dy="0.35em">
        {room.number}
      </text>
      {allocation ? (
        <DeptText x={x} y={y + 48} dept={allocation.am} width={width} max={allocation.am ? 38 : 30} min={24} />
      ) : null}
    </>
  );
}

/** Live is a circle and delayed is a diamond, so the two differ by shape as well as by colour. */
function StatusMark({ kind, cx, cy }: { kind: Exclude<RoomMark, null>; cx: number; cy: number }) {
  if (kind === "active") return <circle className="fp-mark fp-mark-active" cx={cx} cy={cy} r={16} />;
  const d = 20;
  return <path className="fp-mark fp-mark-delayed" d={`M${cx} ${cy - d}L${cx + d} ${cy}L${cx} ${cy + d}L${cx - d} ${cy}Z`} />;
}

export function FloorPlan({
  selectedId,
  marks,
  date,
  onSelect,
}: {
  selectedId: string | null;
  marks: Record<string, RoomMark>;
  date: string;
  onSelect: (id: string) => void;
}) {
  const allocations: Record<string, RoomAllocation | null> = {};
  for (const room of ROOMS) {
    if (room.kind === "or") allocations[room.id] = allocationFor(room.id, date);
  }

  const usedDepartments = new Map<string, Department>();
  for (const allocation of Object.values(allocations)) {
    for (const dept of [allocation?.am, allocation?.pm]) if (dept) usedDepartments.set(dept.code, dept);
  }

  return (
    <svg viewBox="0 0 1207 1706" className="h-full w-auto max-w-none" role="group" aria-label="แปลนห้องผ่าตัด">
      <FloorScenery />
      <defs>
        {[...usedDepartments.values()].map((dept) => {
          const [x1, y1, x2, y2] = DIRECTIONS[DEPT_ORDER.indexOf(dept.code) % DIRECTIONS.length];
          return (
            <linearGradient key={dept.code} id={`fp-grad-${dept.code}`} x1={x1} y1={y1} x2={x2} y2={y2}>
              <stop offset="0" stopColor={dept.gradient[0]} />
              <stop offset="1" stopColor={dept.gradient[1]} />
            </linearGradient>
          );
        })}
        {ROOMS.map((room) => {
          const allocation = allocations[room.id];
          if (!allocation?.split) return null;
          const [amFrom, amTo] = allocation.am?.gradient ?? [UNALLOCATED_FILL, UNALLOCATED_FILL];
          const [pmFrom, pmTo] = allocation.pm?.gradient ?? [UNALLOCATED_FILL, UNALLOCATED_FILL];
          return (
            <linearGradient key={room.id} id={`fp-split-${room.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={amFrom} />
              <stop offset="0.5" stopColor={amTo} />
              <stop offset="0.5" stopColor={pmFrom} />
              <stop offset="1" stopColor={pmTo} />
            </linearGradient>
          );
        })}
      </defs>
      <g id="fp-rooms">
        {ROOMS.map((room) => {
          const selected = room.id === selectedId;
          const mark = marks[room.id];
          const selectable = isSelectableRoom(room);
          const allocation = allocations[room.id] ?? null;
          const fill = floorFill(room, allocation);
          const bounds = roomBounds(room);
          const parts = [roomLabel(room)];
          if (allocation) parts.push(allocationText(allocation));
          if (mark && selectable) parts.push(MARK_LABEL[mark]);
          return (
            <g
              key={room.id}
              id={room.id}
              data-zone={room.zone}
              className={`${room.kind === "or" ? "fp-or" : "fp-recovery"}${selected ? " is-selected" : ""}${selectable ? "" : " is-static"}`}
              style={fill ? ({ "--rf": fill } as CSSProperties) : undefined}
            >
              <path
                className="fp-floor"
                d={room.d}
                role={selectable ? "button" : undefined}
                tabIndex={selectable ? 0 : undefined}
                aria-pressed={selectable ? selected : undefined}
                aria-label={selectable ? parts.join(" · ") : undefined}
                aria-hidden={selectable ? undefined : true}
                onClick={selectable ? () => onSelect(room.id) : undefined}
                onKeyDown={
                  selectable
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(room.id);
                        }
                      }
                    : undefined
                }
              />
              <path className="fp-wall" d={room.d} pointerEvents="none" />
              {room.kind === "or" ? <RoomLabel room={room} allocation={allocation} /> : null}
              {mark && selectable ? (
                <StatusMark
                  kind={mark}
                  cx={bounds.maxX - 34}
                  cy={allocation?.split ? (bounds.minY + bounds.maxY) / 2 : bounds.minY + 34}
                />
              ) : null}
            </g>
          );
        })}
      </g>
      <rect className="fp-wall fp-outer" x="20" y="20" width="1167" height="1666" pointerEvents="none" />
    </svg>
  );
}
