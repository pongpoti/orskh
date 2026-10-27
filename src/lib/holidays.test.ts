import assert from "node:assert/strict";
import { test } from "node:test";
import { holidayIn, parseBotHolidays, parseExtraHolidays } from "./holidays.ts";

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
