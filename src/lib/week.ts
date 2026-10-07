import { WEEK_DATA } from "../data/week-data.ts";
import { allocationFor, type DeptCode } from "./allocation.ts";
import { DAY_KEYS, DAY_NAMES, type DayKey } from "./days.ts";
import { listPhysicians } from "./physicians.ts";
import type { CaseStatus, Operation, Shift } from "./schedule.ts";

/** One row of the OR system export, reduced to what the board shows. Built by scripts/build_week.py. */
export type WeekCase = {
  /** 0 = Monday … 4 = Friday. */
  day: number;
  /** OR number the export recorded, or null when it left the room blank. */
  room: number | null;
  dept: DeptCode | null;
  surgeon: string;
  title: string;
  proc: string;
  status: CaseStatus;
  shift: Shift | null;
  dressing: boolean;
  emergency: boolean;
};

export type WeekFile = {
  meta: { days: string[]; rows: number; kept: number; dropped: Record<string, number> };
  cases: WeekCase[];
};

/** Spellings in the export that differ from the physician list. */
const ALIASES: Record<string, string> = {
  "วันทนันท์ หล่อวัฒนกิจชัย": "วันทนันท์ หล่อวัฒนากิจชัย",
};

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

let known: Map<string, { name: string; specialty: string }> | null = null;

/** Look a surgeon up in the supplied physician list. Unknown names are kept as the export wrote them. */
export function resolveSurgeon(name: string, title: string): { label: string; specialty: string | null } {
  known ??= new Map(listPhysicians().map((person) => [squash(person.name), person]));
  const clean = squash(name);
  const person = known.get(ALIASES[clean] ?? clean);
  const shown = person ? person.name : clean;
  return { label: [title, shown].filter(Boolean).join(" "), specialty: person ? person.specialty : null };
}

export type DayBoard = {
  key: DayKey;
  name: (typeof DAY_NAMES)[number];
  /** Calendar date behind the day. It decides which department holds each room, not what the header shows. */
  date: string;
  operations: Operation[];
  /** Cases the export gave no room and the allocation table cannot place. */
  unplaced: Operation[];
};

/**
 * Where a case with no recorded room goes, by the report's rules: dressing cases use OR 1,
 * emergency cases OR 8 (obstetrics-gynaecology stays in its own room), and anything else
 * the room its department holds that day. A department with several rooms is pooled, so
 * the case goes to the one with the fewest cases so far.
 */
function inferRoom(item: WeekCase, date: string, load: Map<string, number>): string | null {
  if (item.dressing) return "or-1";
  if (item.emergency && item.dept !== "OBGYN") return "or-8";
  if (!item.dept) return null;

  const rooms: string[] = [];
  for (let n = 1; n <= 13; n += 1) {
    const allocation = allocationFor(`or-${n}`, date);
    if (allocation?.am?.code === item.dept || allocation?.pm?.code === item.dept) rooms.push(`or-${n}`);
  }
  if (rooms.length === 0) return null;
  return rooms.reduce((best, room) => ((load.get(room) ?? 0) < (load.get(best) ?? 0) ? room : best));
}

/** SCOPE is general surgery done endoscopically, so a general-surgery case fits a SCOPE room and the reverse. */
const SAME_TEAM: Partial<Record<string, string>> = { GENSX: "SCOPE", SCOPE: "GENSX" };

/**
 * Whether the room's department, by the schedule, differs from the case's own. OR 1 (dressing)
 * and OR 8 (emergency) take cases from any department, as the report's rules say, so they never flag.
 */
function isOffSchedule(item: WeekCase, roomId: string, date: string): boolean {
  if (!item.dept || roomId === "or-1" || roomId === "or-8") return false;
  const allocation = allocationFor(roomId, date);
  if (!allocation) return false;
  const fits = (code: string | undefined) => code === item.dept || code === SAME_TEAM[item.dept as string];
  return !fits(allocation.am?.code) && !fits(allocation.pm?.code);
}

export function weekBoard(data: WeekFile = WEEK_DATA): DayBoard[] {
  return DAY_KEYS.map((key, day) => {
    const date = data.meta.days[day];
    const rows = data.cases.filter((item) => item.day === day);
    const load = new Map<string, number>();
    const placed = new Map<WeekCase, string | null>();

    // Rooms the export recorded come first, so inferred cases balance around them.
    for (const item of rows) {
      if (item.room === null) continue;
      const roomId = `or-${item.room}`;
      placed.set(item, roomId);
      load.set(roomId, (load.get(roomId) ?? 0) + 1);
    }
    for (const item of rows) {
      if (item.room !== null) continue;
      const roomId = inferRoom(item, date, load);
      placed.set(item, roomId);
      if (roomId) load.set(roomId, (load.get(roomId) ?? 0) + 1);
    }

    const order = new Map<string, number>();
    const operations: Operation[] = [];
    const unplaced: Operation[] = [];
    rows.forEach((item, index) => {
      const roomId = placed.get(item) ?? null;
      const slot = (order.get(roomId ?? "none") ?? 0) + 1;
      order.set(roomId ?? "none", slot);
      const surgeon = resolveSurgeon(item.surgeon, item.title);
      const operation: Operation = {
        id: `${date}-${index}`,
        roomId: roomId ?? "",
        order: slot,
        procedure: item.proc,
        surgeon: surgeon.label,
        specialty: surgeon.specialty,
        status: item.status,
        shift: item.shift,
        offSchedule: roomId ? isOffSchedule(item, roomId, date) : false,
      };
      (roomId ? operations : unplaced).push(operation);
    });

    return { key, name: DAY_NAMES[day], date, operations, unplaced };
  });
}
