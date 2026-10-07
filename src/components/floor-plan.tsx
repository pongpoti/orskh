"use client";

import type { CSSProperties } from "react";
import { FloorScenery } from "@/components/floor-scenery";
import { allocationFor, allocationText, readableTextOn, type Department, type RoomAllocation } from "@/lib/allocation";
import { isSelectableRoom, roomBounds, roomLabel, ROOMS, type Room } from "@/lib/rooms";
import type { RoomMark } from "@/lib/schedule";

/** A room with no case that day. White text reads on it (7:1). */
const EMPTY_FILL = "#59646b";
/** A room the schedule gives to no department, yet has cases. Darker than the service-area gray so the two differ. */
const UNALLOCATED_FILL = "#cbd3d7";

const MARK_LABEL: Record<Exclude<RoomMark, null>, string> = {
  active: "กำลังใช้งาน",
  delayed: "มีเคสเลื่อน",
};

function floorFill(room: Room, allocation: RoomAllocation | null, empty: boolean): string | undefined {
  if (empty) return EMPTY_FILL;
  if (!allocation) return undefined;
  if (allocation.split) return `url(#fp-split-${room.id})`;
  return allocation.am?.color ?? UNALLOCATED_FILL;
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
  empty,
}: {
  x: number;
  y: number;
  dept: Department | null;
  width: number;
  max: number;
  min: number;
  empty: boolean;
}) {
  const text = dept ? dept.label : "ไม่จัดสรร";
  return (
    <text
      className="fp-dept"
      x={x}
      y={y}
      dy="0.35em"
      style={{ fontSize: fitSize(text, width, max, min), fill: empty ? "#ffffff" : dept ? readableTextOn(dept.color) : "var(--fp-ink)" }}
    >
      {text}
    </text>
  );
}

/** Room number in a white badge, with the owning department(s) beside it. */
function RoomLabel({ room, allocation, empty }: { room: Room; allocation: RoomAllocation | null; empty: boolean }) {
  const { minX, maxX, minY, maxY } = roomBounds(room);
  const { labelX: x, labelY: y } = room;
  const width = maxX - minX - 48;

  if (allocation?.split) {
    // Two bands (morning above, afternoon below) with the badge on the seam.
    const radius = 32;
    return (
      <>
        <DeptText x={x} y={(minY + (y - radius)) / 2} dept={allocation.am} width={width} max={30} min={22} empty={empty} />
        <DeptText x={x} y={(y + radius + maxY) / 2} dept={allocation.pm} width={width} max={30} min={22} empty={empty} />
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
        <DeptText x={x} y={y + 48} dept={allocation.am} width={width} max={allocation.am ? 38 : 30} min={24} empty={empty} />
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
  cases,
  date,
  onSelect,
}: {
  selectedId: string | null;
  marks: Record<string, RoomMark>;
  /** Number of cases in each room that day. */
  cases: Record<string, number>;
  date: string;
  onSelect: (id: string) => void;
}) {
  const allocations: Record<string, RoomAllocation | null> = {};
  for (const room of ROOMS) {
    if (room.kind === "or") allocations[room.id] = allocationFor(room.id, date);
  }

  return (
    <svg viewBox="0 0 1207 1706" className="h-full w-auto max-w-none" role="group" aria-label="แปลนห้องผ่าตัด">
      <FloorScenery />
      <defs>
        {ROOMS.map((room) => {
          const allocation = allocations[room.id];
          if (!allocation?.split || (cases[room.id] ?? 0) === 0) return null;
          return (
            <linearGradient key={room.id} id={`fp-split-${room.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0.5" stopColor={allocation.am?.color ?? UNALLOCATED_FILL} />
              <stop offset="0.5" stopColor={allocation.pm?.color ?? UNALLOCATED_FILL} />
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
          const empty = room.kind === "or" && (cases[room.id] ?? 0) === 0;
          const fill = floorFill(room, allocation, empty);
          const bounds = roomBounds(room);
          const parts = [roomLabel(room)];
          if (allocation) parts.push(allocationText(allocation));
          if (empty) parts.push("ไม่มีเคส");
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
              <path className={room.kind === "or" ? "fp-wall" : "fp-wall fp-thin"} d={room.d} pointerEvents="none" />
              {room.kind === "or" ? <RoomLabel room={room} allocation={allocation} empty={empty} /> : null}
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
