import assert from "node:assert/strict";
import { test } from "node:test";
import { botHolidayFeed, holidayIn, parseBotHolidays, parseExtraHolidays } from "./holidays.ts";

test("reads the Bank of Thailand holiday list", () => {
  const json = {
    result: {
      api: "Financial Institutions' Holidays",
      timestamp: "2026-10-27 09:00:00",
      data: [
        { HolidayWeekDay: "Friday", HolidayWeekDayThai: "ศุกร์", Date: "2026-10-23", DateThai: "23/10/2569", HolidayDescription: "King Chulalongkorn Memorial Day", HolidayDescriptionThai: "วันปิยมหาราช" },
        { Date: "2026-12-31", HolidayDescription: "Additional special holiday" },
        { Date: "not a date", HolidayDescriptionThai: "x" },
      ],
    },
  };
  assert.deepEqual(parseBotHolidays(json), [
    { date: "2026-10-23", name: "วันปิยมหาราช" },
    { date: "2026-12-31", name: "Additional special holiday" },
  ]);
  assert.deepEqual(parseBotHolidays(null), []);
  assert.deepEqual(parseBotHolidays({ result: {} }), []);
  assert.deepEqual(parseBotHolidays({ error: "unauthorised" }), []);
});

test("reads extra closures and finds the holiday on a date", () => {
  const extra = parseExtraHolidays(" 2026-12-30=ปิดปรับปรุง , 2026-12-31,nope, ");
  assert.deepEqual(extra, [
    { date: "2026-12-30", name: "ปิดปรับปรุง" },
    { date: "2026-12-31", name: "วันหยุด" },
  ]);
  assert.deepEqual(parseExtraHolidays(undefined), []);
  assert.equal(holidayIn(extra, "2026-12-31")?.name, "วันหยุด");
  assert.equal(holidayIn(extra, "2026-12-29"), null);
});

test("the feed says why there are no holidays: no token, a refused token, or no answer", async (t) => {
  const calls: { url: string; auth: string | null; cache: string | null; revalidate: number | null }[] = [];
  let answer: () => Promise<Response> = async () => new Response(JSON.stringify({ result: { data: [{ Date: "2026-12-10", HolidayDescriptionThai: "วันรัฐธรรมนูญ" }] } }));
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const next = (init as { next?: { revalidate?: number } } | undefined)?.next;
    calls.push({ url, auth: new Headers(init?.headers).get("Authorization"), cache: init?.cache ?? null, revalidate: next?.revalidate ?? null });
    return answer();
  });
  t.mock.method(console, "warn", () => {});

  // An explicit empty token, so the test does not read BOT_API_TOKEN from the shell.
  assert.deepEqual(await botHolidayFeed(2026, { token: "" }), { state: "no-token" });
  assert.deepEqual(await botHolidayFeed(2026, { token: "  \n" }), { state: "no-token" });
  assert.equal(calls.length, 0, "no token, no request");

  assert.deepEqual(await botHolidayFeed(2026, { token: " token-123\n" }), { state: "ok", holidays: [{ date: "2026-12-10", name: "วันรัฐธรรมนูญ" }] });
  assert.deepEqual(calls.at(-1), {
    url: "https://gateway.api.bot.or.th/financial-institutions-holidays/?year=2026",
    auth: "token-123",
    cache: null,
    revalidate: 21600, // the board's answer is kept for six hours
  });

  answer = async () => new Response("unauthorised", { status: 401 });
  assert.deepEqual(await botHolidayFeed(2026, { token: "wrong" }), { state: "failed", status: 401 });

  answer = async () => new Response("not json");
  assert.deepEqual(await botHolidayFeed(2026, { token: "token-123" }), { state: "failed", status: null });

  answer = async () => {
    throw new TypeError("fetch failed");
  };
  assert.deepEqual(await botHolidayFeed(2026, { token: "token-123" }), { state: "failed", status: null });
});
