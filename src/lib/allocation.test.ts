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
  // Monday to Friday, mornings, one row per OR, as drawn in the 4 Nov 2026 schedule. 5 Oct is the 1st Monday (CVT in
  // OR 11, ORTHO in OR 13); the split days and the Monday turns are tested below.
  const grid: Record<string, string[]> = {
    "or-1": ["INFECT", "INFECT", "INFECT", "INFECT", "INFECT"],
    "or-2": ["GENSX", "GENSX", "GENSX", "GENSX", "GENSX"],
    "or-3": ["SCOPE", "SCOPE", "SCOPE", "SCOPE", "SCOPE"],
    "or-4": ["OBGYN", "ENT", "ENT", "ENT", "ENT"],
    "or-5": ["GENSX", "PEDSX", "PEDSX", "GENSX", "GENSX"],
    "or-6": ["OBGYN", "OBGYN", "OBGYN", "OBGYN", "OBGYN"],
    "or-7": ["URO", "URO", "URO", "URO", "URO"],
    "or-8": ["EMER", "EMER", "EMER", "EMER", "EMER"],
    "or-9": ["PLASTIC", "MAXILLO", "PLASTIC", "PLASTIC", "OBGYN"],
    "or-10": ["EYE", "EYE", "EYE", "EYE", "EYE"],
    "or-11": ["CVT", "ORTHO", "ORTHO", "ORTHO", "VASCULAR"],
    "or-12": ["ORTHO", "NEURO", "ORTHO", "NEURO", "ORTHO"],
    "or-13": ["ORTHO", "ORTHO", "CVT", "ORTHO", "ORTHO"],
  };
  for (const [roomId, codes] of Object.entries(grid)) {
    assert.deepEqual(WEEK.map((date) => code(roomId, date)), codes, roomId);
  }
});

test("keeps each room's department all day, except OR 5 on Tuesday and OR 11 on Friday", () => {
  const friday = allocationFor("or-11", "2026-10-09");
  assert.deepEqual([friday?.am?.code, friday?.pm?.code, friday?.split], ["VASCULAR", "NEPHRO", true]);
  assert.equal(allocationText(friday!), "เช้า ศัลยกรรมหลอดเลือด · บ่าย อายุรกรรมโรคไต");
  const tuesday = allocationFor("or-5", "2026-10-06");
  assert.deepEqual([tuesday?.am?.code, tuesday?.pm?.code, tuesday?.split], ["PEDSX", "GENSX", true]);
  const split = new Set(["or-11 2026-10-09", "or-5 2026-10-06"]);
  for (const room of ROOMS.filter((item) => item.kind === "or")) {
    for (const date of WEEK) {
      if (split.has(`${room.id} ${date}`)) continue;
      const allocation = allocationFor(room.id, date);
      assert.equal(allocation?.split, false, `${room.id} ${date}`);
      assert.equal(allocation?.am?.code, allocation?.pm?.code);
    }
  }
  assert.equal(allocationText(allocationFor("or-7", MON)!), "ศัลยกรรมทางเดินปัสสาวะ");
});

test("alternates OR 11 and OR 13 on Monday by the week of the month", () => {
  // Weeks 1, 3 and 5: CVT in OR 11, ORTHO in OR 13. Weeks 2 and 4: ORTHO in OR 11, CVT in OR 13. The whole day.
  const mondays: [string, string, string][] = [
    ["2026-10-05", "CVT", "ORTHO"],
    ["2026-10-12", "ORTHO", "CVT"],
    ["2026-10-19", "CVT", "ORTHO"],
    ["2026-10-26", "ORTHO", "CVT"],
    ["2026-11-30", "CVT", "ORTHO"], // a 5th Monday
  ];
  for (const [date, or11, or13] of mondays) {
    for (const part of ["am", "pm"] as const) {
      assert.equal(code("or-11", date, part), or11, `OR 11 ${date} ${part}`);
      assert.equal(code("or-13", date, part), or13, `OR 13 ${date} ${part}`);
    }
  }
  // OR 5 on Tuesday does not alternate: paediatric surgery in the morning, general surgery in the afternoon, every week.
  for (const date of ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]) {
    assert.equal(code("or-5", date), "PEDSX", date);
    assert.equal(code("or-5", date, "pm"), "GENSX", date);
  }
  // Other days of OR 11 and OR 13 do not alternate.
  for (const date of ["2026-10-07", "2026-10-14"]) assert.equal(code("or-13", date), "CVT", date);
  for (const date of ["2026-10-06", "2026-10-13"]) assert.equal(code("or-11", date), "ORTHO", date);
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
  // The schedule's periods in a week whose Monday is in week 1 of the month (one period is a half day).
  const periods: Record<string, number> = {};
  for (const room of ROOMS.filter((item) => item.kind === "or")) {
    for (const date of WEEK) {
      const allocation = allocationFor(room.id, date)!;
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

test("uses the department colours of the 4 Nov 2026 schedule image", () => {
  const list = {
    GENSX: "#0E5E6F", EYE: "#0F7FA0", ENT: "#2F5FA8", CVT: "#5E6A73", ORTHO: "#4F3D8C", MAXILLO: "#7E5C92",
    OBGYN: "#8C3B6E", VASCULAR: "#B94769", SCOPE: "#B04A3A", PLASTIC: "#B45E04", PEDSX: "#937000", NEURO: "#8A5A22",
    INFECT: "#7B7252", NEPHRO: "#667924", CHEST: "#6367BC", URO: "#2E7D5B", EMER: "#1C1C1C", MINOR: "#6B7377", MIXED: "#6E5A4B",
    UNK: "#78746F",
  };
  assert.deepEqual(Object.fromEntries(Object.values(DEPARTMENTS).map((dept) => [dept.code, dept.color])), list);
  assert.equal(new Set(Object.values(DEPARTMENTS).map((dept) => dept.color)).size, 20);
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
