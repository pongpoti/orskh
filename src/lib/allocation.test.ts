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

test("gives each OR to the department the schedule names", () => {
  assert.equal(code("or-1", MON), "INFECT");
  assert.equal(code("or-2", MON), "GENSX");
  assert.equal(code("or-3", MON), "SCOPE");
  assert.equal(code("or-4", MON), "OBGYN");
  assert.equal(code("or-4", "2026-10-06"), "ENT");
  assert.equal(code("or-8", "2026-10-09"), "EMER");
  assert.equal(code("or-10", "2026-10-07"), "EYE");
  assert.equal(code("or-11", "2026-10-08"), "CVT");
  assert.equal(code("or-12", MON), "NEURO");
  assert.equal(code("or-13", "2026-10-09"), "CVT");
});

test("splits ORs 7 and 9 into morning and afternoon", () => {
  const or7 = allocationFor("or-7", MON);
  assert.equal(or7?.am?.code, "URO");
  assert.equal(or7?.pm?.code, "PLASTIC");
  assert.equal(or7?.split, true);
  assert.equal(allocationText(or7!), "เช้า ศัลยกรรมระบบปัสสาวะ · บ่าย ศัลยกรรมตกแต่ง");

  const or9 = allocationFor("or-9", MON);
  assert.deepEqual([or9?.am?.code, or9?.pm?.code], ["VAS", "NEPHRO"]);

  const friday = allocationFor("or-7", "2026-10-09");
  assert.equal(friday?.split, false);
  assert.equal(friday?.am?.code, "OBGYN");
  assert.equal(allocationText(friday!), "สูติ-นรีเวชกรรม");
});

test("alternates OR 5 by the week of the month", () => {
  // Tuesday: weeks 2 and 4 are paediatric surgery, 1, 3 and 5 general surgery.
  assert.equal(code("or-5", "2026-10-06"), "GENSX");
  assert.equal(code("or-5", "2026-10-13"), "PEDSX");
  assert.equal(code("or-5", "2026-10-20"), "GENSX");
  assert.equal(code("or-5", "2026-10-27"), "PEDSX");
  // Thursday: weeks 1, 3 and 5 are maxillofacial, 2 and 4 general surgery.
  assert.equal(code("or-5", "2026-10-01"), "MAXILLO");
  assert.equal(code("or-5", "2026-10-08"), "GENSX");
  assert.equal(code("or-5", "2026-10-15"), "MAXILLO");
  assert.equal(code("or-5", "2026-10-22"), "GENSX");
  assert.equal(code("or-5", "2026-10-29"), "MAXILLO");
  // Other days do not alternate.
  assert.equal(code("or-5", MON), "GENSX");
  assert.equal(code("or-5", "2026-10-07"), "PEDSX");
  assert.equal(code("or-5", "2026-10-09"), "ORTHO");
});

test("knows when a room is unallocated or the schedule is silent", () => {
  const empty = allocationFor("or-11", "2026-10-06");
  assert.deepEqual([empty?.am, empty?.pm, empty?.split], [null, null, false]);
  assert.equal(allocationText(empty!), "ไม่จัดสรร");

  assert.equal(allocationFor("or-2", "2026-10-03"), null, "Saturday");
  assert.equal(allocationFor("or-2", "2026-10-04"), null, "Sunday");
  assert.equal(allocationFor("r-1", MON), null, "recovery room");
  assert.equal(allocationFor("or-2", "nope"), null);
});

test("covers every OR on every weekday, with one gap", () => {
  const ors = ROOMS.filter((room) => room.kind === "or");
  assert.equal(ors.length, 13);
  let gaps = 0;
  for (const room of ors) {
    for (const date of WEEK) {
      const allocation = allocationFor(room.id, date);
      assert.ok(allocation, `${room.id} ${date}`);
      if (!allocation.am && !allocation.pm) gaps += 1;
    }
  }
  assert.equal(gaps, 1);
});

test("keeps the plan labels", () => {
  assert.equal(DEPARTMENTS.INFECT.label, "dressing");
  assert.equal(DEPARTMENTS.EMER.label, "EMER");
  assert.equal(DEPARTMENTS.PLASTIC.label, "PLASTIC");
});

test("keeps the report's department colours", () => {
  const report = {
    GENSX: "#0E5E6F", SCOPE: "#B79CED", VAS: "#1D3F8F", ORTHO: "#E3A21A", OBGYN: "#C9D86A", EYE: "#81D4FA",
    URO: "#3FA37A", PLASTIC: "#8E5BA8", ENT: "#5A92D6", NEPHRO: "#16A5B8", PEDSX: "#E0607E", NEURO: "#A8662A",
    CVT: "#9A9A94", MAXILLO: "#E8825A", INFECT: "#B3261E", EMER: "#B5179E", MINOR: "#E3E8EA",
  };
  assert.deepEqual(Object.fromEntries(Object.values(DEPARTMENTS).map((dept) => [dept.code, dept.color])), report);
  assert.equal(new Set(Object.values(DEPARTMENTS).map((dept) => dept.color)).size, 17);
});

test("picks white or ink text, whichever reads better", () => {
  assert.equal(readableTextOn("#0E5E6F"), "#ffffff");
  assert.equal(readableTextOn("#1D3F8F"), "#ffffff");
  assert.equal(readableTextOn("#B3261E"), "#ffffff");
  assert.equal(readableTextOn("#C9D86A"), INK);
  assert.equal(readableTextOn("#E3A21A"), INK);
  assert.equal(readableTextOn("#E3E8EA"), INK);
});

test("every department label meets 4.5:1 contrast on its colour", () => {
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
    assert.ok(contrast(dept.color, readableTextOn(dept.color)) >= 4.5, `${dept.code} ${dept.color}`);
  }
  // White text on the "no case" gray, and ink text on the "no department" gray.
  assert.ok(contrast("#59646b", "#ffffff") >= 4.5);
  assert.ok(contrast("#cbd3d7", INK) >= 4.5);
});

test("room outlines enclose their label point", () => {
  for (const room of ROOMS) {
    const { minX, minY, maxX, maxY } = roomBounds(room);
    assert.ok(room.labelX > minX && room.labelX < maxX, `${room.id} x`);
    assert.ok(room.labelY > minY && room.labelY < maxY, `${room.id} y`);
  }
});
