import { WEEK_DATA } from "../data/week-data.ts";
import { allocationFor, type DeptCode } from "./allocation.ts";
import { DAY_KEYS, DAY_NAMES, type DayKey } from "./days.ts";
import { listPhysicians } from "./physicians.ts";
import type { CaseStatus, Operation, Shift } from "./schedule.ts";

/** One row of the OR system export, reduced to what the board shows. Built by scripts/build_week.py. */
export type WeekCase = {
  /** 0 = Monday … 4 = Friday. */
  day: number;
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
  /** Cases the schedule gives no correct room: their department holds none that day. */
  unplaced: Operation[];
};

/**
 * Where a case goes, by the report's rules alone (the export's room column is ignored): dressing cases use OR 1,
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

export function weekBoard(data: WeekFile = WEEK_DATA): DayBoard[] {
  return DAY_KEYS.map((key, day) => {
    const date = data.meta.days[day];
    const rows = data.cases.filter((item) => item.day === day);
    const load = new Map<string, number>();
    const placed = new Map<WeekCase, string | null>();

    // The export's room column is not trusted: every case is placed by the schedule's rules alone.
    for (const item of rows) {
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
      };
      (roomId ? operations : unplaced).push(operation);
    });

    return { key, name: DAY_NAMES[day], date, operations, unplaced };
  });
}
