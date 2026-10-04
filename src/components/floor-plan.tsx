"use client";

import { FloorScenery } from "@/components/floor-scenery";
import { isSelectableRoom, roomLabel, ROOMS } from "@/lib/rooms";
import type { RoomMark } from "@/lib/schedule";

export function FloorPlan({
  selectedId,
  marks,
  onSelect,
}: {
  selectedId: string | null;
  marks: Record<string, RoomMark>;
  onSelect: (id: string) => void;
}) {
  return (
    <svg viewBox="0 0 1207 1706" className="h-full w-auto max-w-none" role="group" aria-label="แปลนห้องผ่าตัด">
      <FloorScenery />
      <g id="fp-rooms">
        {ROOMS.map((room) => {
          const selected = room.id === selectedId;
          const mark = marks[room.id];
          const selectable = isSelectableRoom(room);
          return (
            <g
              key={room.id}
              id={room.id}
              data-zone={room.zone}
              className={`${room.kind === "or" ? "fp-or" : "fp-recovery"}${selected ? " is-selected" : ""}${selectable ? "" : " is-static"}`}
            >
              <path
                className="fp-floor"
                d={room.d}
                role={selectable ? "button" : undefined}
                tabIndex={selectable ? 0 : undefined}
                aria-pressed={selectable ? selected : undefined}
                aria-label={selectable ? roomLabel(room) : undefined}
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
              {room.kind === "or" ? (
                <text className="fp-label" x={room.labelX} y={room.labelY} dy="0.35em">
                  {room.number}
                </text>
              ) : null}
              {mark && selectable ? (
                <circle
                  className={mark === "active" ? "fp-mark fp-mark-active" : "fp-mark fp-mark-delayed"}
                  cx={room.labelX}
                  cy={room.labelY + 48}
                  r="12"
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
