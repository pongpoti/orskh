const BANGKOK = "Asia/Bangkok";

export function bangkokToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BANGKOK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function parseBoardDate(value: string | undefined, now = new Date()): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      return value;
    }
  }
  return bangkokToday(now);
}

export function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatThaiDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(noon);
}

export function formatBangkokTime(now = new Date()): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: BANGKOK,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

export function boardHref(
  date: string,
  room?: string | null,
  pathname = "/",
): string {
  const query = new URLSearchParams();
  query.set("date", date);
  if (room) query.set("room", room);
  return `${pathname}?${query.toString()}`;
}
