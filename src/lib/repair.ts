import type { DeptCode } from "./allocation.ts";

/**
 * The air-ventilation repair (Pong, 4 Nov 2026). It starts on 8 Dec 2026 and lasts 90 days, in two halves of 45 days.
 * While it runs the weekly OR schedule (lib/allocation.ts) is set aside: each room in use has one fixed use every
 * working day, the rooms are all drawn in one colour with the department's code as the label, and every other OR is
 * closed.
 *
 * - First half: OR 1 dressing, OR 2 GENSX, OR 3 ORTHO, OR 4 and 5 mixed departments, OR 6 to 8 recovery; OR 9 to 13 closed.
 * - Second half: OR 9 recovery, OR 10 mixed departments, OR 11 dressing, OR 12 GENSX, OR 13 ORTHO; OR 1 to 8 closed.
 *
 * The repair may run longer than 90 days ("at least"): move `to` of the second half to keep its layout.
 */

/** What a room is used for while the repair runs: a department's operating room, or a recovery room ("RR"). */
export type RepairUse = DeptCode | "RR";

export type RepairHalf = {
  /** 1 or 2. */
  half: 1 | 2;
  /** First day, YYYY-MM-DD (Thailand). */
  from: string;
  /** Last day, YYYY-MM-DD, inclusive. */
  to: string;
  /** The rooms in use; any OR not listed is closed. */
  rooms: Readonly<Record<string, RepairUse>>;
};

export const REPAIR_HALVES: readonly RepairHalf[] = [
  {
    half: 1,
    from: "2026-12-08",
    to: "2027-01-21",
    rooms: {
      "or-1": "INFECT",
      "or-2": "GENSX",
      "or-3": "ORTHO",
      "or-4": "MIXED",
      "or-5": "MIXED",
      "or-6": "RR",
      "or-7": "RR",
      "or-8": "RR",
    },
  },
  {
    half: 2,
    from: "2027-01-22",
    to: "2027-03-07",
    rooms: {
      "or-9": "RR",
      "or-10": "MIXED",
      "or-11": "INFECT",
      "or-12": "GENSX",
      "or-13": "ORTHO",
    },
  },
];

/**
 * The one colour every room in use is drawn in during the repair, instead of its department's colour (the app's
 * brown, `--brand-top`; white labels clear 9:1 on it).
 */
export const REPAIR_COLOR = "#54402F";

/** Thai name of a room used as a recovery room during the repair, and its label on the plan. */
export const RECOVERY_USE = { name: "ห้องพักฟื้น (RR)", label: "RR" } as const;

/** The half of the repair that `date` (YYYY-MM-DD) falls in, or null outside the repair or for a malformed date. */
export function repairOn(date: string | null | undefined): RepairHalf | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return REPAIR_HALVES.find((half) => date >= half.from && date <= half.to) ?? null;
}

/** A date as "8 ธ.ค. 2569" (no weekday), for the repair's dates. */
export function shortThaiDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** The board's note while the repair runs, e.g. "ซ่อมระบบระบายอากาศ ช่วงที่ 1 · 8 ธ.ค. 2569 – 21 ม.ค. 2570". */
export function repairNote(half: RepairHalf): string {
  return `ซ่อมระบบระบายอากาศ ช่วงที่ ${half.half} · ${shortThaiDate(half.from)} – ${shortThaiDate(half.to)}`;
}
