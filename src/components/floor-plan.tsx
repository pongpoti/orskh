"use client";

import type { CSSProperties } from "react";
import { FloorScenery } from "@/components/floor-scenery";
import { allocationFor, allocationText, readableTextOn, type Department, type RoomAllocation } from "@/lib/allocation";
import { isSelectableRoom, roomBounds, roomLabel, ROOMS, type Room } from "@/lib/rooms";
import type { RoomMark } from "@/lib/schedule";

/** Weekday room that the schedule leaves unallocated. */
const UNALLOCATED_FILL = "#e8ecee";

function floorFill(room: Room, allocation: RoomAllocation | null): string | undefined {
  if (!allocation) return undefined;
  if (allocation.split) return `url(#fp-split-${room.id})`;
  return allocation.am?.color ?? UNALLOCATED_FILL;
}

function DeptText({ x, y, dept, size }: { x: number; y: number; dept: Department | null; size: number }) {
  return (
    <text
      className="fp-dept"
      x={x}
      y={y}
      dy="0.35em"
      style={{ fontSize: size, fill: dept ? readableTextOn(dept.color) : "var(--fp-muted)" }}
    >
      {dept ? dept.label : "ไม่จัดสรร"}
    </text>
  );
}

/** Room number in a white badge, with the owning department(s) beside it. */
function RoomLabel({ room, allocation }: { room: Room; allocation: RoomAllocation | null }) {
  const { minY, maxY } = roomBounds(room);
  const { labelX: x, labelY: y } = room;

  if (allocation?.split) {
    // Two bands (morning above, afternoon below) with the badge on the seam.
    const radius = 30;
    return (
      <>
        <DeptText x={x} y={(minY + (y - radius)) / 2} dept={allocation.am} size={28} />
        <DeptText x={x} y={(y + radius + maxY) / 2} dept={allocation.pm} size={28} />
        <circle className="fp-badge" cx={x} cy={y} r={radius} />
        <text className="fp-label" x={x} y={y} dy="0.35em" style={{ fontSize: 38 }}>
          {room.number}
        </text>
      </>
    );
  }

  const badgeY = allocation ? y - 30 : y;
  return (
    <>
      <circle className="fp-badge" cx={x} cy={badgeY} r={38} />
      <text className="fp-label" x={x} y={badgeY} dy="0.35em">
        {room.number}
      </text>
      {allocation ? <DeptText x={x} y={y + 44} dept={allocation.am} size={allocation.am ? 32 : 28} /> : null}
    </>
  );
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

  return (
    <svg viewBox="0 0 1207 1706" className="h-full w-auto max-w-none" role="group" aria-label="แปลนห้องผ่าตัด">
      <FloorScenery />
      <defs>
        {ROOMS.map((room) => {
          const allocation = allocations[room.id];
          if (!allocation?.split) return null;
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
          const fill = floorFill(room, allocation);
          const bounds = roomBounds(room);
          const name = allocation ? `${roomLabel(room)} ${allocationText(allocation)}` : roomLabel(room);
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
                aria-label={selectable ? name : undefined}
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
                <circle
                  className={mark === "active" ? "fp-mark fp-mark-active" : "fp-mark fp-mark-delayed"}
                  cx={bounds.maxX - 34}
                  cy={allocation?.split ? (bounds.minY + bounds.maxY) / 2 : bounds.minY + 34}
                  r="15"
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
