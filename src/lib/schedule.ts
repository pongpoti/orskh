export type CaseStatus =
  | "scheduled"
  | "in-progress"
  | "delayed"
  | "done"
  | "cancelled"
  | "recovery";

/** The OR system export carries no start or end times, so cases are listed in export order. */
export type Shift = "in" | "out";

export type Operation = {
  id: string;
  roomId: string;
  /** Position in the room's list for the day, from 1. */
  order: number;
  procedure: string;
  surgeon: string;
  /** Department of the surgeon in the physician list, when the name is on it. */
  specialty: string | null;
  status: CaseStatus;
  shift: Shift | null;
};

export type RoomMark = "active" | "delayed" | null;

export function roomMark(operations: Operation[]): RoomMark {
  if (operations.some((item) => item.status === "in-progress" || item.status === "recovery")) {
    return "active";
  }
  if (operations.some((item) => item.status === "delayed")) return "delayed";
  return null;
}

export function casesForRoom(operations: Operation[], roomId: string): Operation[] {
  return operations.filter((item) => item.roomId === roomId).sort((a, b) => a.order - b.order);
}
