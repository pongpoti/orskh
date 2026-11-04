"use client";

import type { CSSProperties } from "react";
import { FloorScenery } from "@/components/floor-scenery";
import { allocationFor, allocationText, DEPARTMENTS, readableTextOn, type Department, type RoomAllocation } from "@/lib/allocation";
import { RECOVERY_USE, REPAIR_COLOR } from "@/lib/repair";
import { roomBounds, roomLabel, ROOMS, roomUse, type Room, type RoomUse } from "@/lib/rooms";
import type { RoomMark } from "@/lib/schedule";

/** A room the schedule gives to no department: the list's "unknown department" gray. */
export const UNALLOCATED_FILL = DEPARTMENTS.UNK.color;

const MARK_LABEL: Record<Exclude<RoomMark, null>, string> = {
  active: "กำลังใช้งาน",
  delayed: "มีเคสเลื่อน",
};

/** Every OR takes the colour of the department the schedule gives it that day, whether or not it has cases. */
function floorFill(room: Room, allocation: RoomAllocation | null): string | undefined {
  if (!allocation) return undefined;
  if (allocation.split) return `url(#fp-split-${room.id})`;
  return allocation.am?.color ?? UNALLOCATED_FILL;
}

/** Every department label is drawn at this size; the labels are five characters at most, so all fit the narrowest room. */
const DEPT_SIZE = 40;

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
}: {
  x: number;
  y: number;
  dept: Department | null;
  width: number;
}) {
  const text = dept ? dept.label : "ไม่จัดสรร";
  return (
    <text
      className="fp-dept"
      x={x}
      y={y}
      dy="0.35em"
      style={{ fontSize: dept ? DEPT_SIZE : fitSize(text, width, 34, 28), fill: readableTextOn(dept?.color ?? UNALLOCATED_FILL) }}
    >
      {text}
    </text>
  );
}

/**
 * Room number in a white badge, with the owning department(s) beside it, ปิด for a closed room, or RR for a room
 * used as a recovery room during the ventilation repair.
 */
function RoomLabel({
  room,
  allocation,
  use,
  suiteOpen,
}: {
  room: Room;
  allocation: RoomAllocation | null;
  use: RoomUse;
  /** The suite runs a list today (not a weekend or holiday), so rooms take their colour. */
  suiteOpen: boolean;
}) {
  const { minX, maxX, minY, maxY } = roomBounds(room);
  const { labelX: x, labelY: y } = room;
  const width = maxX - minX - 48;

  if (use !== "open") {
    const short = maxY - minY < 170;
    const badgeY = y - (short ? 30 : 36);
    const closed = use === "closed";
    return (
      <>
        <circle className="fp-badge" cx={x} cy={badgeY} r={short ? 36 : 47} />
        <text className="fp-label" x={x} y={badgeY} dy="0.35em" style={short ? { fontSize: 44 } : undefined}>
          {room.number}
        </text>
        <text
          className={closed ? "fp-dept fp-closed-text" : "fp-dept"}
          x={x}
          y={y + (short ? 44 : 54)}
          dy="0.35em"
          // A recovery room is in the repair's colour on working days; on a closed day it is plain, like every room.
          style={{ fontSize: DEPT_SIZE, fill: closed ? undefined : suiteOpen ? readableTextOn(REPAIR_COLOR) : "var(--fp-ink)" }}
        >
          {closed ? "ปิด" : RECOVERY_USE.label}
        </text>
      </>
    );
  }

  if (allocation?.split) {
    // Two bands (morning above, afternoon below) with the badge on the seam.
    const radius = 36;
    return (
      <>
        <DeptText x={x} y={(minY + (y - radius)) / 2} dept={allocation.am} width={width} />
        <DeptText x={x} y={(y + radius + maxY) / 2} dept={allocation.pm} width={width} />
        <circle className="fp-badge" cx={x} cy={y} r={radius} />
        <text className="fp-label" x={x} y={y} dy="0.35em" style={{ fontSize: 44 }}>
          {room.number}
        </text>
      </>
    );
  }

  // OR 7 is shorter than the others, so its badge and label sit closer together.
  const short = maxY - minY < 170;
  const badgeY = allocation ? y - (short ? 30 : 36) : y;
  return (
    <>
      <circle className="fp-badge" cx={x} cy={badgeY} r={short ? 36 : 47} />
      <text className="fp-label" x={x} y={badgeY} dy="0.35em" style={short ? { fontSize: 44 } : undefined}>
        {room.number}
      </text>
      {allocation ? (
        <DeptText x={x} y={y + (short ? 44 : 54)} dept={allocation.am} width={width} />
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
  day,
  onSelect,
}: {
  selectedId: string | null;
  marks: Record<string, RoomMark>;
  /** Number of cases in each room that day. */
  cases: Record<string, number>;
  /** The day whose allocation colours the rooms, or null when the suite is closed and no room is allocated. */
  date: string | null;
  /** The day that decides which rooms are open, closed or recovery rooms (today, even when the suite is closed). */
  day: string;
  onSelect: (id: string) => void;
}) {
  const uses: Record<string, RoomUse> = {};
  const allocations: Record<string, RoomAllocation | null> = {};
  for (const room of ROOMS) {
    if (room.kind !== "or") continue;
    uses[room.id] = roomUse(room, day);
    // A closed room, or one used for recovery, belongs to no department.
    allocations[room.id] = date && uses[room.id] === "open" ? allocationFor(room.id, date) : null;
  }

  return (
    <svg viewBox="0 0 1207 1706" preserveAspectRatio="xMidYMin meet" className="h-full w-auto max-w-none" role="group" aria-label="แปลนห้องผ่าตัด">
      <FloorScenery />
      <defs>
        {/* Closed rooms: thin diagonal stripes on a plain floor. */}
        <pattern id="fp-closed" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="28" height="28" fill="var(--fp-closed)" />
          <line x1="0" y1="0" x2="0" y2="28" stroke="var(--fp-closed-line)" strokeWidth="6" />
        </pattern>
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
          const use = uses[room.id];
          const selectable = use === "open";
          const closed = use === "closed";
          // An OR used as a recovery room during the repair: the repair's colour, labelled RR, and nothing to open.
          const recovery = use === "recovery";
          const allocation = allocations[room.id] ?? null;
          const empty = room.kind === "or" && (cases[room.id] ?? 0) === 0;
          // On a closed day (weekend, holiday) no room takes a colour, a recovery room included.
          const fill = closed ? "url(#fp-closed)" : recovery ? (date ? REPAIR_COLOR : undefined) : floorFill(room, allocation);
          const bounds = roomBounds(room);
          const parts = [roomLabel(room)];
          if (allocation) parts.push(allocationText(allocation));
          if (empty) parts.push("ไม่มีเคส");
          if (mark && selectable) parts.push(MARK_LABEL[mark]);
          const staticLabel = closed ? `${roomLabel(room)} · ปิด` : recovery ? `${roomLabel(room)} · ${RECOVERY_USE.name}` : undefined;
          return (
            <g
              key={room.id}
              id={room.id}
              data-zone={room.zone}
              data-use={use}
              className={`${room.kind === "or" ? "fp-or" : "fp-recovery"}${selected ? " is-selected" : ""}${selectable ? "" : " is-static"}${closed ? " is-closed" : ""}${recovery ? " is-rr" : ""}`}
              style={fill ? ({ "--rf": fill } as CSSProperties) : undefined}
            >
              <path
                className="fp-floor"
                d={room.d}
                tabIndex={selectable ? 0 : undefined}
                aria-pressed={selectable ? selected : undefined}
                aria-label={selectable ? parts.join(" · ") : staticLabel}
                aria-hidden={selectable || staticLabel ? undefined : true}
                role={selectable ? "button" : staticLabel ? "img" : undefined}
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
              {room.kind === "or" ? <RoomLabel room={room} allocation={allocation} use={use} suiteOpen={date !== null} /> : null}
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
