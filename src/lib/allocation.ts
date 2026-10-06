/**
 * Which department owns each operating room, Monday to Friday.
 *
 * Source: the schedule page of "รายงานวิเคราะห์การใช้งานห้องผ่าตัด ปีงบประมาณ 2569"
 * (ตารางจัดสรรห้องผ่าตัด, updated 5 August 2567). The plan shows each department in one
 * teal-green tone with its own gradient; the report's department hues are not used.
 * ORs 7 and 9 are split: morning 08:00–12:00, afternoon 13:00–16:00. OR 5
 * alternates by week of the month on Tuesday and Thursday.
 */

export type DeptCode =
  | "GENSX"
  | "SCOPE"
  | "VAS"
  | "ORTHO"
  | "OBGYN"
  | "EYE"
  | "URO"
  | "PLASTIC"
  | "ENT"
  | "NEPHRO"
  | "PEDSX"
  | "NEURO"
  | "CVT"
  | "MAXILLO"
  | "INFECT"
  | "EMER"
  | "MINOR";

export type Department = {
  code: DeptCode;
  /** Full Thai name, as in the report's abbreviation key. */
  name: string;
  /** Short text drawn on the plan: the code, except OR 1 which the report writes as "dressing". */
  label: string;
  /** Mid-tone, used to pick readable text and for flat swatches. */
  color: string;
  /** Gradient ends, top-left to bottom-right. Every department stays in one surgical teal-green tone. */
  gradient: readonly [string, string];
};

function dept(code: DeptCode, name: string, from: string, to: string, label: string = code): Department {
  return { code, name, label, color: mix(from, to), gradient: [from, to] };
}

function mix(a: string, b: string): string {
  const channel = (offset: number) =>
    Math.round((parseInt(a.slice(offset, offset + 2), 16) + parseInt(b.slice(offset, offset + 2), 16)) / 2)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`.toUpperCase();
}

export const DEPARTMENTS: Record<DeptCode, Department> = {
  GENSX: dept("GENSX", "ศัลยกรรมทั่วไป", "#0E3C31", "#072018"),
  SCOPE: dept("SCOPE", "ศัลย์ scope", "#F7FCFC", "#D4F2ED"),
  VAS: dept("VAS", "ศัลยกรรมหลอดเลือด", "#104444", "#082826"),
  ORTHO: dept("ORTHO", "ศัลยกรรมกระดูกและข้อ", "#ECF9F6", "#C8EFE3"),
  OBGYN: dept("OBGYN", "สูติ-นรีเวชกรรม", "#124C46", "#0A312A"),
  EYE: dept("EYE", "จักษุวิทยา", "#E0F5F5", "#BCEBE8"),
  URO: dept("URO", "ศัลยกรรมระบบปัสสาวะ", "#145546", "#0C392C"),
  PLASTIC: dept("PLASTIC", "ศัลยกรรมตกแต่ง", "#D5F1EE", "#B0E8DD"),
  ENT: dept("ENT", "โสต ศอ นาสิก", "#165F5F", "#0E4440"),
  NEPHRO: dept("NEPHRO", "อายุรกรรมโรคไต", "#C9EDE5", "#A5E4D1"),
  PEDSX: dept("PEDSX", "ศัลยกรรมเด็ก", "#196960", "#104E43"),
  NEURO: dept("NEURO", "ศัลยกรรมระบบประสาท", "#BEE9E9", "#99E1DC"),
  CVT: dept("CVT", "ศัลยกรรมหัวใจและทรวงอก", "#1B745F", "#125944"),
  MAXILLO: dept("MAXILLO", "ศัลยกรรมแม๊กซิลโลเฟเชียล", "#B3E6E0", "#8DDDCE"),
  INFECT: dept("INFECT", "ห้องติดเชื้อ / dressing", "#1E7E7E", "#14635E", "dressing"),
  EMER: dept("EMER", "เคสฉุกเฉิน", "#A7E2D4", "#81D9BF"),
  MINOR: dept("MINOR", "หัตถการเล็ก (minor)", "#9CDED6", "#76D6C4"),
};

/** A department holding the room on a given day. `nth` limits it to those occurrences of the weekday in the month. */
type Turn = { dept: DeptCode; nth?: readonly number[] };
/** Empty means the room is not allocated that day. */
type Slot = readonly Turn[];
/** Monday to Friday. */
type WeekPlan = readonly [Slot, Slot, Slot, Slot, Slot];

const NONE: Slot = [];
const one = (code: DeptCode): Slot => [{ dept: code }];
const always = (code: DeptCode): WeekPlan => [one(code), one(code), one(code), one(code), one(code)];

type RoomPlan = { am: WeekPlan; pm: WeekPlan };
const whole = (plan: WeekPlan): RoomPlan => ({ am: plan, pm: plan });

const PLAN: Record<string, RoomPlan> = {
  "or-1": whole(always("INFECT")),
  "or-2": whole(always("GENSX")),
  "or-3": whole(always("SCOPE")),
  "or-4": whole([one("OBGYN"), one("ENT"), one("ENT"), one("ENT"), one("ENT")]),
  "or-5": whole([
    one("GENSX"),
    [
      { dept: "PEDSX", nth: [2, 4] },
      { dept: "GENSX", nth: [1, 3, 5] },
    ],
    one("PEDSX"),
    [
      { dept: "MAXILLO", nth: [1, 3, 5] },
      { dept: "GENSX", nth: [2, 4] },
    ],
    one("ORTHO"),
  ]),
  "or-6": whole(always("OBGYN")),
  "or-7": {
    am: [one("URO"), one("MAXILLO"), one("URO"), one("URO"), one("OBGYN")],
    pm: [one("PLASTIC"), one("PLASTIC"), one("MAXILLO"), one("PLASTIC"), one("OBGYN")],
  },
  "or-8": whole(always("EMER")),
  "or-9": {
    am: [one("VAS"), one("MINOR"), one("MINOR"), one("MINOR"), one("VAS")],
    pm: always("NEPHRO"),
  },
  "or-10": whole(always("EYE")),
  "or-11": whole([one("ORTHO"), NONE, one("ORTHO"), one("CVT"), one("ORTHO")]),
  "or-12": whole([one("NEURO"), one("ORTHO"), one("NEURO"), one("ORTHO"), one("NEURO")]),
  "or-13": whole([one("CVT"), one("ORTHO"), one("ORTHO"), one("ORTHO"), one("CVT")]),
};

export type RoomAllocation = {
  /** Morning owner, or null when the room is not allocated. */
  am: Department | null;
  /** Afternoon owner. Same as `am` for rooms that are not split. */
  pm: Department | null;
  /** Morning and afternoon belong to different departments. */
  split: boolean;
};

/** 0 = Monday … 6 = Sunday, or null for anything that is not a calendar date. */
export function weekdayIndex(iso: string): number | null {
  const date = parseDate(iso);
  return date ? (date.getUTCDay() + 6) % 7 : null;
}

/** Which occurrence of its weekday this date is within the month (1–5). */
export function weekOfMonth(iso: string): number | null {
  const date = parseDate(iso);
  return date ? Math.floor((date.getUTCDate() - 1) / 7) + 1 : null;
}

function parseDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date : null;
}

function owner(slot: Slot, nth: number): Department | null {
  const turn = slot.find((item) => !item.nth || item.nth.includes(nth));
  return turn ? DEPARTMENTS[turn.dept] : null;
}

/**
 * Who holds `roomId` on `date` (YYYY-MM-DD). Null when the schedule says nothing:
 * a weekend, an unknown room, or an invalid date.
 */
export function allocationFor(roomId: string, date: string): RoomAllocation | null {
  const plan = PLAN[roomId];
  const day = weekdayIndex(date);
  const nth = weekOfMonth(date);
  if (!plan || day === null || nth === null || day > 4) return null;

  const am = owner(plan.am[day], nth);
  const pm = owner(plan.pm[day], nth);
  return { am, pm, split: am?.code !== pm?.code };
}

/** Plain-text owner for labels and tooltips, e.g. "เช้า ศัลยกรรมระบบปัสสาวะ · บ่าย ศัลยกรรมตกแต่ง". */
export function allocationText(allocation: RoomAllocation): string {
  if (allocation.split) {
    return [
      `เช้า ${allocation.am?.name ?? "ไม่จัดสรร"}`,
      `บ่าย ${allocation.pm?.name ?? "ไม่จัดสรร"}`,
    ].join(" · ");
  }
  return allocation.am?.name ?? "ไม่จัดสรร";
}

/** Same as the UI ink. Dark text on every department colour clears 4.5:1 at this value. */
export const INK = "#14262c";

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** White or ink, whichever reads better on `hex` (#rrggbb). */
export function readableTextOn(hex: string): string {
  const light = luminance(hex);
  const againstWhite = 1.05 / (light + 0.05);
  const againstInk = (light + 0.05) / (luminance(INK) + 0.05);
  return againstWhite >= againstInk ? "#ffffff" : INK;
}
