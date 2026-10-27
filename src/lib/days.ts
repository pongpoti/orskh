/** The five working days the case data covers. Kept apart from the case data so client code can import it cheaply. */
export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri"] as const;
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

export type DayKey = (typeof DAY_KEYS)[number];

/** The hospital's clock: the board turns over at midnight in Thailand, wherever the server runs. */
export const TIME_ZONE = "Asia/Bangkok";

/** Day index from a `?day=` value such as "tue", or null when the value names no working day. */
export function parseDay(value: string | undefined | null): number | null {
  const index = DAY_KEYS.indexOf(String(value ?? "").trim().toLowerCase() as DayKey);
  return index === -1 ? null : index;
}

/** Today's calendar date in Thailand, as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Working-day index (0 = Monday … 4 = Friday) for a YYYY-MM-DD date, or null at the weekend. */
export function workdayIndex(iso: string): number | null {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return weekday > 4 ? null : weekday;
}

/** A date written out in Thai with the Buddhist year, e.g. "วันอังคารที่ 27 ตุลาคม 2569". */
export function thaiDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = new Intl.DateTimeFormat("th-TH", { weekday: "long", timeZone: "UTC" }).format(date);
  const rest = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  const [day, ...tail] = rest.split(" ");
  return `${weekday}ที่ ${day} ${tail.join(" ")}`;
}

/** Selection id for cases that no room can be worked out for. */
export const UNPLACED_ID = "unplaced";

/** Board URL with an optional selected room. Other parameters in `search` (such as the preview's `day`) are kept. */
export function boardHref(room?: string | null, pathname = "/", search = ""): string {
  const query = new URLSearchParams(search);
  if (room) query.set("room", room);
  else query.delete("room");
  const qs = query.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
