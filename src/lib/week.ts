import { WEEK_DATA } from "../data/week-data.ts";
import { allocationFor, type DeptCode } from "./allocation.ts";
import { DAY_KEYS, DAY_NAMES, type DayKey } from "./days.ts";
import { listPhysicians, teamOf } from "./physicians.ts";
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
export function resolveSurgeon(name: string, title: string): { label: string; specialty: string | null; team: ReturnType<typeof teamOf> } {
  known ??= new Map(listPhysicians().map((person) => [squash(person.name), person]));
  const clean = squash(name);
  const person = known.get(ALIASES[clean] ?? clean);
  const shown = person ? person.name : clean;
  return { label: [title, shown].filter(Boolean).join(" "), specialty: person ? [person.specialty, teamOf(person.name)].filter(Boolean).join(" · ") : null,
    team: person ? teamOf(person.name) : null,
  };
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

/** Words that mark a dressing case (wound dressing, done in OR 1), matched on the lower-cased operation name. */
const DRESSING_INCLUDE =
  /dressing|(?<![a-z])d\s*\/\s*s(?![a-z])|(?<![a-z])ds(?![a-z])|(?<![a-z])dw(?![a-z])|ทำแผล|ล้างแผล|เปลี่ยนแผล|change\s+vac|vac+\s*d/;
/** ...unless the name also holds another procedure: debridement, scrub, graft, closure and so on. */
const DRESSING_EXCLUDE = [
  /debri|(?<![a-z])d\.?b\.?(?![a-z])/,
  /scrub/,
  /graft|stsg|sskg|suture|closure|escharotomy|fasciotomy|excision|excise|incision|amputat/,
];

/**
 * A dressing case, from any sub-specialty. The export has no operation-items column, so the "every item must
 * be a dressing" step of the hospital's algorithm is skipped and the result is the broader definition.
 */
export function isDressingCase(procedure: string): boolean {
  const text = procedure.toLowerCase();
  return DRESSING_INCLUDE.test(text) && !DRESSING_EXCLUDE.some((pattern) => pattern.test(text));
}

/** Operation names that belong in the SCOPE room (matched case-insensitively). */
const SCOPE_INCLUDE = /\begd\b|gastroscop|esophagoscop|\bogd\b|colono|sigmoido|\bercp\b|endoscop|\beus\b/i;
/** ...unless they are a foreign-body removal. */
const SCOPE_EXCLUDE = /remove\s*fb|foreign body|\bfb\b/i;

/** A case for the SCOPE room: a GENSX-labelled surgeon and an endoscopic operation that is not a foreign-body removal. */
export function isScopeCase(procedure: string, team: string | null): boolean {
  return team === "GENSX" && SCOPE_INCLUDE.test(procedure) && !SCOPE_EXCLUDE.test(procedure);
}

/**
 * Where a case goes, by the report's rules alone (the export's room column is ignored): dressing cases use OR 1,
 * emergency cases OR 8 (obstetrics-gynaecology stays in its own room), and anything else
 * the room its department holds that day. A department with several rooms is pooled, so
 * the case goes to the one with the fewest cases so far.
 *
 * The SCOPE room is exclusive: only a GENSX-labelled surgeon's endoscopic case enters it, and such a
 * case goes nowhere else. Other general-surgery cases use the GENSX rooms.
 */
function inferRoom(item: WeekCase, date: string, load: Map<string, number>, team: string | null): string | null {
  if (isDressingCase(item.proc)) return "or-1";
  if (item.emergency && item.dept !== "OBGYN") return "or-8";
  const dept = isScopeCase(item.proc, team) ? "SCOPE" : item.dept === "SCOPE" ? "GENSX" : item.dept;
  if (!dept) return null;

  const rooms: string[] = [];
  for (let n = 1; n <= 13; n += 1) {
    const allocation = allocationFor(`or-${n}`, date);
    if (n === 1) continue; // OR 1 is for dressing cases only
    if (allocation?.am?.code === dept || allocation?.pm?.code === dept) rooms.push(`or-${n}`);
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
      const roomId = inferRoom(item, date, load, resolveSurgeon(item.surgeon, item.title).team);
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
