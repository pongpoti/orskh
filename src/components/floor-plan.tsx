import { memo } from "react";
import { FloorScenery } from "@/components/floor-scenery";
import { roomLabel, ROOMS } from "@/lib/rooms";
import type { RoomMark } from "@/lib/schedule";

export const FloorPlan = memo(function FloorPlan({
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
          return (
            <g
              key={room.id}
              id={room.id}
              data-zone={room.zone}
              className={`${room.kind === "or" ? "fp-or" : "fp-recovery"}${selected ? " is-selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={roomLabel(room)}
              onClick={() => onSelect(room.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(room.id);
                }
              }}
            >
              <path className="fp-floor" d={room.d} />
              <path className="fp-wall" d={room.d} />
              {room.kind === "or" ? (
                <text className="fp-label" x={room.labelX} y={room.labelY} dy="0.35em">
                  {room.number}
                </text>
              ) : null}
              {mark ? (
                <circle
                  className={mark === "active" ? "fp-mark fp-mark-active" : "fp-mark fp-mark-delayed"}
                  cx={room.labelX}
                  cy={room.kind === "or" ? room.labelY + 48 : room.labelY}
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
});
