/** The five working days the board shows. Kept apart from the case data so client code can import it cheaply. */
export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri"] as const;
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

export type DayKey = (typeof DAY_KEYS)[number];

/** Day index from a `?day=` value such as "tue". Monday is the default. */
export function parseDay(value: string | undefined | null): number {
  const index = DAY_KEYS.indexOf(String(value ?? "").trim().toLowerCase() as DayKey);
  return index === -1 ? 0 : index;
}

/** Selection id for cases that no room can be worked out for. */
export const UNPLACED_ID = "unplaced";

/** Board URL for a day (Monday is the default and stays out of the query) and an optional selected room. */
export function boardHref(day: DayKey, room?: string | null, pathname = "/"): string {
  const query = new URLSearchParams();
  if (day !== "mon") query.set("day", day);
  if (room) query.set("room", room);
  const qs = query.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
