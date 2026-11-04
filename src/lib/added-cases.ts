import { allocationFor } from "./allocation.ts";
import { workdayIndex } from "./days.ts";
import { openRooms, roomUse } from "./rooms.ts";
import type { Operation, Shift } from "./schedule.ts";
import { subtypeLabel } from "./user-labels.ts";
import type { DayBoard } from "./week.ts";

/**
 * Cases a doctor adds on the board (the เพิ่มเคส button), checked the same way in the form and in the server action.
 * Isomorphic: no server-only imports. The database side is lib/cases.ts.
 */

/** Longest operation name, in characters (the cases table checks the same). */
export const MAX_OPERATION = 300;
/** How far ahead a case can be added, in days from today. */
export const BOOK_AHEAD_DAYS = 60;

export type CaseInput = {
  /** The operation's day in Thailand, YYYY-MM-DD. */
  date: string;
  roomId: string;
  operation: string;
  shift: Shift;
};

/** A case from the cases table, as the board and the form show it. */
export type AddedCase = CaseInput & {
  id: string;
  /** The surgeon (the doctor who added it), "ชื่อ นามสกุล". */
  surgeon: string;
  /** The surgeon's subtype code (users.subtype), e.g. ORTHO. */
  subtype: string | null;
};

export type CheckedCase = { ok: true; value: CaseInput } | { ok: false; error: string };

/** `iso` moved by `days` calendar days. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** One line, NFC, no invisible format characters, single spaces. */
export function cleanOperation(v: string): string {
  return v.normalize("NFC").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
}

/** The first weekday (Monday to Friday) on or after `iso`. Holidays are not known here; the server checks them. */
export function nextWorkday(iso: string): string {
  let day = iso;
  while (workdayIndex(day) === null) day = addDays(day, 1);
  return day;
}

/**
 * Checks a new case against today's date in Thailand (YYYY-MM-DD). Holidays are checked by the server action
 * (they come from the Bank of Thailand), so a weekday is all this asks for.
 */
export function checkCase(input: unknown, today: string): CheckedCase {
  const raw = (input ?? {}) as Record<string, unknown>;
  const date = raw.date;
  if (!isIsoDate(date)) return { ok: false, error: "เลือกวันที่ผ่าตัด" };
  if (date < today) return { ok: false, error: "เลือกวันนี้หรือวันถัดไป" };
  if (date > addDays(today, BOOK_AHEAD_DAYS)) return { ok: false, error: `เพิ่มเคสล่วงหน้าได้ไม่เกิน ${BOOK_AHEAD_DAYS} วัน` };
  if (workdayIndex(date) === null) return { ok: false, error: "วันเสาร์และอาทิตย์ไม่มีตารางผ่าตัด" };

  const roomId = raw.roomId;
  if (typeof roomId !== "string" || !roomId) return { ok: false, error: "เลือกห้องผ่าตัด" };
  const use = roomUse(roomId, date);
  if (use === "recovery") return { ok: false, error: "ห้องนี้ใช้เป็นห้องพักฟื้นในวันที่เลือก เลือกห้องอื่น" };
  if (use !== "open") return { ok: false, error: "ห้องนี้ปิดในวันที่เลือก เลือกห้องอื่น" };

  if (typeof raw.operation !== "string") return { ok: false, error: "ใส่ชื่อการผ่าตัด" };
  const operation = cleanOperation(raw.operation);
  if (!operation) return { ok: false, error: "ใส่ชื่อการผ่าตัด" };
  if (operation.length > MAX_OPERATION) return { ok: false, error: `ชื่อการผ่าตัดยาวเกิน ${MAX_OPERATION} ตัวอักษร` };

  const shift = raw.shift ?? "in";
  if (shift !== "in" && shift !== "out") return { ok: false, error: "เลือกในเวลาหรือนอกเวลา" };

  return { ok: true, value: { date, roomId, operation, shift } };
}

/**
 * The open room the doctor's department holds on `date` (morning or afternoon). During the ventilation repair a
 * department with no room of its own gets the first mixed-department room. Null when there is neither.
 */
export function roomForSubtype(subtype: string | null | undefined, date: string): string | null {
  if (!subtype) return null;
  let mixed: string | null = null;
  for (const room of openRooms(date)) {
    const allocation = allocationFor(room.id, date);
    if (allocation?.am?.code === subtype || allocation?.pm?.code === subtype) return room.id;
    if (!mixed && allocation?.am?.code === "MIXED") mixed = room.id;
  }
  return mixed;
}

/**
 * The board with the doctors' added cases for its day after the imported ones in each room, in the order they were
 * added. Cases in a room that is not in use for operations that day (closed, or a recovery room during the repair)
 * are left off.
 */
export function withAddedCases(board: DayBoard, added: readonly AddedCase[]): DayBoard {
  const order = new Map<string, number>();
  for (const item of board.operations) order.set(item.roomId, Math.max(order.get(item.roomId) ?? 0, item.order));

  const operations: Operation[] = [...board.operations];
  for (const item of added) {
    if (item.date !== board.date || roomUse(item.roomId, board.date) !== "open") continue;
    const slot = (order.get(item.roomId) ?? 0) + 1;
    order.set(item.roomId, slot);
    operations.push({
      id: `case-${item.id}`,
      roomId: item.roomId,
      order: slot,
      procedure: item.operation,
      surgeon: item.surgeon,
      specialty: subtypeLabel("DR", item.subtype),
      status: "scheduled",
      shift: item.shift,
    });
  }
  return { ...board, operations };
}
