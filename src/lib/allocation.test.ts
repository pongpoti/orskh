import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocationFor,
  allocationText,
  DEPARTMENTS,
  INK,
  readableTextOn,
  weekdayIndex,
  weekOfMonth,
} from "./allocation.ts";
import { ROOMS, roomBounds } from "./rooms.ts";

const MON = "2026-10-05";
const WEEK = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
const code = (roomId: string, date: string, part: "am" | "pm" = "am") =>
  allocationFor(roomId, date)?.[part]?.code ?? null;

test("reads the weekday and the week of the month from a date", () => {
  assert.equal(weekdayIndex(MON), 0);
  assert.equal(weekdayIndex("2026-10-09"), 4);
  assert.equal(weekdayIndex("2026-10-04"), 6);
  assert.equal(weekOfMonth("2026-10-01"), 1);
  assert.equal(weekOfMonth("2026-10-07"), 1);
  assert.equal(weekOfMonth("2026-10-08"), 2);
  assert.equal(weekOfMonth("2026-10-29"), 5);
  assert.equal(weekdayIndex("nope"), null);
  assert.equal(weekdayIndex("2026-02-31"), null);
});

test("gives each OR to the department the proposed schedule names", () => {
  // Monday to Friday, one row per OR, as drawn in the schedule (OR 5 Tuesday and OR 10 Friday tested below).
  const grid: Record<string, string[]> = {
    "or-1": ["INFECT", "INFECT", "INFECT", "INFECT", "INFECT"],
    "or-2": ["GENSX", "GENSX", "GENSX", "GENSX", "GENSX"],
    "or-3": ["SCOPE", "SCOPE", "SCOPE", "SCOPE", "SCOPE"],
    "or-4": ["OBGYN", "ENT", "ENT", "ENT", "ENT"],
    "or-5": ["GENSX", "GENSX", "PEDSX", "GENSX", "GENSX"],
    "or-6": ["OBGYN", "OBGYN", "OBGYN", "OBGYN", "OBGYN"],
    "or-7": ["URO", "URO", "URO", "URO", "URO"],
    "or-8": ["EMER", "EMER", "EMER", "EMER", "EMER"],
    "or-9": ["PLASTIC", "MAXILLO", "PLASTIC", "PLASTIC", "OBGYN"],
    "or-10": ["CVT", "ORTHO", "ORTHO", "ORTHO", "VASCULAR"],
    "or-11": ["EYE", "EYE", "EYE", "EYE", "EYE"],
    "or-12": ["ORTHO", "NEURO", "ORTHO", "NEURO", "ORTHO"],
    "or-13": ["ORTHO", "ORTHO", "CVT", "ORTHO", "ORTHO"],
  };
  for (const [roomId, codes] of Object.entries(grid)) {
    assert.deepEqual(WEEK.map((date) => code(roomId, date)), codes, roomId); // 6 Oct is the 1st Tuesday: GENSX
  }
});

test("keeps each room's department all day, except OR 10 on Friday", () => {
  const friday = allocationFor("or-10", "2026-10-09");
  assert.deepEqual([friday?.am?.code, friday?.pm?.code, friday?.split], ["VASCULAR", "NEPHRO", true]);
  assert.equal(allocationText(friday!), "เช้า ศัลยกรรมหลอดเลือด · บ่าย อายุรกรรมโรคไต");
  for (const room of ROOMS.filter((item) => item.kind === "or")) {
    for (const date of WEEK) {
      if (room.id === "or-10" && date === "2026-10-09") continue;
      const allocation = allocationFor(room.id, date);
      assert.equal(allocation?.split, false, `${room.id} ${date}`);
      assert.equal(allocation?.am?.code, allocation?.pm?.code);
    }
  }
  assert.equal(allocationText(allocationFor("or-7", MON)!), "ศัลยกรรมทางเดินปัสสาวะ");
});

test("alternates OR 5 on Tuesday by the week of the month", () => {
  // Weeks 2 and 4 are paediatric surgery, 1, 3 and 5 general surgery.
  assert.equal(code("or-5", "2026-10-06"), "GENSX");
  assert.equal(code("or-5", "2026-10-13"), "PEDSX");
  assert.equal(code("or-5", "2026-10-20"), "GENSX");
  assert.equal(code("or-5", "2026-10-27"), "PEDSX");
  assert.equal(code("or-5", "2026-09-29"), "GENSX"); // a 5th Tuesday
  assert.equal(code("or-5", "2026-10-27", "pm"), "PEDSX"); // the whole day, not half
  // Other days do not alternate.
  for (const date of ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]) assert.equal(code("or-5", date), "GENSX", date);
  assert.equal(code("or-5", "2026-10-07"), "PEDSX");
  assert.equal(code("or-5", "2026-10-14"), "PEDSX");
});

test("knows when the schedule is silent", () => {
  assert.equal(allocationFor("or-2", "2026-10-03"), null, "Saturday");
  assert.equal(allocationFor("or-2", "2026-10-04"), null, "Sunday");
  assert.equal(allocationFor("r-1", MON), null, "recovery room");
  assert.equal(allocationFor("or-2", "nope"), null);
});

test("gives every OR a department on every weekday", () => {
  const ors = ROOMS.filter((room) => room.kind === "or");
  assert.equal(ors.length, 13);
  for (const room of ors) {
    for (const date of WEEK) {
      const allocation = allocationFor(room.id, date);
      assert.ok(allocation?.am && allocation.pm, `${room.id} ${date}`);
    }
  }
});

test("matches the schedule's half-day periods per department", () => {
  // The schedule's legend, in periods a week (one period is a half day). OR 5 Tuesday counts one each.
  const periods: Record<string, number> = {};
  for (const room of ROOMS.filter((item) => item.kind === "or")) {
    for (const date of WEEK) {
      const allocation = allocationFor(room.id, date)!;
      if (room.id === "or-5" && date === "2026-10-06") {
        periods.GENSX = (periods.GENSX ?? 0) + 1;
        periods.PEDSX = (periods.PEDSX ?? 0) + 1;
        continue;
      }
      for (const dept of [allocation.am!, allocation.pm!]) periods[dept.code] = (periods[dept.code] ?? 0) + 1;
    }
  }
  assert.deepEqual(periods, {
    INFECT: 10, GENSX: 17, SCOPE: 10, OBGYN: 14, ENT: 8, PEDSX: 3, URO: 10, EMER: 10,
    PLASTIC: 6, MAXILLO: 2, CVT: 4, ORTHO: 20, VASCULAR: 1, NEPHRO: 1, EYE: 10, NEURO: 4,
  });
  assert.equal(Object.values(periods).reduce((a, b) => a + b, 0), 130);
});

test("keeps the plan labels short", () => {
  assert.equal(DEPARTMENTS.INFECT.label, "D/S");
  assert.equal(DEPARTMENTS.VASCULAR.label, "VAS");
  assert.equal(DEPARTMENTS.PLASTIC.label, "PLAST");
  assert.equal(DEPARTMENTS.NEPHRO.label, "NEPHR");
  assert.equal(DEPARTMENTS.MAXILLO.label, "MAXI");
  assert.equal(DEPARTMENTS.EMER.label, "EMER");
  for (const dept of Object.values(DEPARTMENTS)) assert.ok(dept.label.length <= 5, dept.code);
});

test("uses the redesigned department colours", () => {
  const list = {
    GENSX: "#116370", EYE: "#3C7A9E", ENT: "#315A97", CVT: "#566572", ORTHO: "#503983", MAXILLO: "#82608A",
    OBGYN: "#822F5C", VASCULAR: "#A72B48", SCOPE: "#9B4630", PLASTIC: "#AA5F04", PEDSX: "#8D6F18", NEURO: "#5C3D27",
    INFECT: "#7B6C54", NEPHRO: "#5C732D", URO: "#2D6D42", EMER: "#28201B", MINOR: "#6B7377", UNK: "#78746F",
  };
  assert.deepEqual(Object.fromEntries(Object.values(DEPARTMENTS).map((dept) => [dept.code, dept.color])), list);
  assert.equal(new Set(Object.values(DEPARTMENTS).map((dept) => dept.color)).size, 18);
});

test("picks white or ink text, whichever reads better", () => {
  assert.equal(readableTextOn("#0E5E6F"), "#ffffff");
  assert.equal(readableTextOn("#1D3F8F"), "#ffffff");
  assert.equal(readableTextOn("#B3261E"), "#ffffff");
  assert.equal(readableTextOn("#C9D86A"), INK);
  assert.equal(readableTextOn("#E3A21A"), INK);
  assert.equal(readableTextOn("#E3E8EA"), INK);
});

test("every department label is white and meets 4.5:1 on its colour", () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const dept of Object.values(DEPARTMENTS)) {
    assert.equal(readableTextOn(dept.color), "#ffffff", dept.code);
    assert.ok(contrast(dept.color, "#ffffff") >= 4.5, `${dept.code} ${dept.color}`);
  }
});

test("room outlines enclose their label point", () => {
  for (const room of ROOMS) {
    const { minX, minY, maxX, maxY } = roomBounds(room);
    assert.ok(room.labelX > minX && room.labelX < maxX, `${room.id} x`);
    assert.ok(room.labelY > minY && room.labelY < maxY, `${room.id} y`);
  }
});
