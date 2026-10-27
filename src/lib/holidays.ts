/**
 * Thai public and special holidays, when the operating suite runs no elective list.
 *
 * Source: the Bank of Thailand's Financial Institutions' Holidays API, which lists the public holidays,
 * substitution days and the special holidays the cabinet announces during the year. It needs a free
 * token from https://portal.api.bot.or.th in BOT_API_TOKEN. Dates the API does not know, such as a
 * hospital-only closure, can be added in EXTRA_HOLIDAYS ("2026-12-30=ปิดปรับปรุง,2026-12-31").
 */

export type Holiday = { date: string; name: string };

const ENDPOINT = "https://gateway.api.bot.or.th/financial-institutions-holidays/";
/** Special holidays are announced at short notice, so the list is fetched again every six hours. */
const REVALIDATE_SECONDS = 6 * 60 * 60;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The holidays in a BOT API response: `{ result: { data: [{ Date, HolidayDescriptionThai, … }] } }`. */
export function parseBotHolidays(json: unknown): Holiday[] {
  const data = (json as { result?: { data?: unknown } } | null)?.result?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const date = typeof item?.Date === "string" ? item.Date.trim().slice(0, 10) : "";
    if (!ISO_DATE.test(date)) return [];
    const name = [item.HolidayDescriptionThai, item.HolidayDescription].find((value) => typeof value === "string" && value.trim());
    return [{ date, name: typeof name === "string" ? name.trim() : "วันหยุด" }];
  });
}

/** Extra closures from EXTRA_HOLIDAYS: comma-separated dates, each optionally followed by `=name`. */
export function parseExtraHolidays(raw: string | undefined): Holiday[] {
  return (raw ?? "").split(",").flatMap((entry) => {
    const [date, ...name] = entry.split("=");
    const day = date.trim();
    return ISO_DATE.test(day) ? [{ date: day, name: name.join("=").trim() || "วันหยุด" }] : [];
  });
}

/** The holiday on `iso`, if any. A date listed twice keeps its first name. */
export function holidayIn(holidays: readonly Holiday[], iso: string): Holiday | null {
  return holidays.find((holiday) => holiday.date === iso) ?? null;
}

/**
 * What the BOT API gave for one year: the holidays, or why there are none. The admin page shows it, so a wrong
 * or missing token is visible without reading the server logs.
 */
export type HolidayFeed =
  | { state: "ok"; holidays: Holiday[] }
  | { state: "no-token" }
  /** `status` is the HTTP status the API answered with, or null when it could not be reached or read. */
  | { state: "failed"; status: number | null };

/** One year's holidays from the BOT API. */
export async function botHolidayFeed(year: number, raw: string | undefined = process.env.BOT_API_TOKEN): Promise<HolidayFeed> {
  // A token pasted into Vercel can pick up a stray space or line break.
  const token = raw?.trim();
  if (!token) return { state: "no-token" };
  try {
    // Only 200 answers are cached, so a refused token is asked about again on the next request.
    const response = await fetch(`${ENDPOINT}?year=${year}`, {
      headers: { Authorization: token, Accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
    } as RequestInit);
    if (!response.ok) {
      console.warn(`BOT holidays API answered ${response.status} for ${year}`);
      return { state: "failed", status: response.status };
    }
    return { state: "ok", holidays: parseBotHolidays(await response.json()) };
  } catch (error) {
    console.warn("BOT holidays API could not be reached", error);
    return { state: "failed", status: null };
  }
}

/** The holiday on a YYYY-MM-DD date in Thailand, from EXTRA_HOLIDAYS first, then the BOT API. */
export async function holidayOn(iso: string): Promise<Holiday | null> {
  const extra = holidayIn(parseExtraHolidays(process.env.EXTRA_HOLIDAYS), iso);
  if (extra) return extra;
  const feed = await botHolidayFeed(Number(iso.slice(0, 4)));
  return feed.state === "ok" ? holidayIn(feed.holidays, iso) : null;
}
