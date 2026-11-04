import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCase, roomForSubtype, withAddedCases, type AddedCase } from "./added-cases.ts";
import { allocationFor, DEPARTMENTS, readableTextOn } from "./allocation.ts";
import { REPAIR_COLOR, REPAIR_HALVES, repairNote, repairOn } from "./repair.ts";
import { getRoom, isRecoveryUse, isSelectableRoom, numberRanges, openRooms, roomUse, unusedRoomsText } from "./rooms.ts";
import { weekBoard, type WeekCase, type WeekFile } from "./week.ts";

// The repair: 8 Dec 2026 to 7 Mar 2027, two halves of 45 days. Dates below are weekdays unless noted.
const BEFORE = "2026-12-07"; // Monday
const FIRST_DAY = "2026-12-08"; // Tuesday
const FIRST_LAST = "2027-01-21"; // Thursday
const SECOND_DAY = "2027-01-22"; // Friday
const SECOND_LAST = "2027-03-05"; // Friday (7 Mar, the last day, is a Sunday)
const AFTER = "2027-03-08"; // Monday

const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;

test("the repair starts on 8 Dec 2026 and runs two halves of 45 days, 90 in all", () => {
  const [first, second] = REPAIR_HALVES;
  assert.equal(first.from, "2026-12-08");
  assert.equal(daysBetween(first.from, first.to), 45);
  assert.equal(daysBetween(second.from, second.to), 45);
  assert.equal(daysBetween(first.from, second.to), 90);
  assert.equal(daysBetween(first.to, second.from), 2, "the second half starts the day after the first ends");

  assert.equal(repairOn(BEFORE), null);
  assert.equal(repairOn(FIRST_DAY)?.half, 1);
  assert.equal(repairOn(FIRST_LAST)?.half, 1);
  assert.equal(repairOn(SECOND_DAY)?.half, 2);
  assert.equal(repairOn("2027-03-07")?.half, 2);
  assert.equal(repairOn(AFTER), null);
  assert.equal(repairOn("2026-12-8"), null);
  assert.equal(repairOn(null), null);
});

test("first half: OR 1 to 5 operate, OR 6 to 8 are recovery rooms, OR 9 to 13 are closed", () => {
  for (const date of [FIRST_DAY, FIRST_LAST, "2026-12-12" /* Saturday */]) {
    assert.deepEqual(openRooms(date).map((room) => room.id), ["or-1", "or-2", "or-3", "or-4", "or-5"], date);
    for (const n of [6, 7, 8]) assert.equal(roomUse(`or-${n}`, date), "recovery", `OR ${n} ${date}`);
    for (const n of [9, 10, 11, 12, 13]) assert.equal(roomUse(`or-${n}`, date), "closed", `OR ${n} ${date}`);
  }
  assert.equal(unusedRoomsText(FIRST_DAY), "OR 6–8 เป็นห้องพักฟื้น · OR 9–13 ปิด");
});

test("second half: OR 10 to 13 operate, OR 9 is a recovery room, OR 1 to 8 are closed", () => {
  for (const date of [SECOND_DAY, SECOND_LAST]) {
    assert.deepEqual(openRooms(date).map((room) => room.id), ["or-10", "or-11", "or-12", "or-13"], date);
    assert.equal(roomUse("or-9", date), "recovery");
    for (let n = 1; n <= 8; n += 1) assert.equal(roomUse(`or-${n}`, date), "closed", `OR ${n} ${date}`);
  }
  assert.equal(unusedRoomsText(SECOND_DAY), "OR 9 เป็นห้องพักฟื้น · OR 1–8 ปิด");
  assert.equal(unusedRoomsText(BEFORE), "OR 6–13 ปิด");
});

test("recovery rooms and closed rooms cannot be opened on the plan", () => {
  assert.equal(isSelectableRoom(getRoom("or-6")!, FIRST_DAY), false);
  assert.equal(isRecoveryUse(getRoom("or-6")!, FIRST_DAY), true);
  assert.equal(isRecoveryUse(getRoom("or-6")!, BEFORE), false);
  assert.equal(isSelectableRoom(getRoom("or-12")!, SECOND_DAY), true);
  assert.equal(isSelectableRoom(getRoom("or-2")!, SECOND_DAY), false);
  assert.equal(roomUse("r-1", FIRST_DAY), "closed", "the recovery area is not an OR");
  assert.equal(roomUse("nope", FIRST_DAY), "closed");
});

test("rooms hold one department all day, whatever the weekly schedule says, all in one colour", () => {
  const code = (roomId: string, date: string) => allocationFor(roomId, date)?.am?.code ?? null;
  // First half, on a Monday (OR 4 is OBGYN on Mondays in the schedule) and a Tuesday (OR 5 is PEDSX/GENSX).
  for (const date of ["2026-12-14", "2026-12-15"]) {
    assert.equal(code("or-1", date), "INFECT");
    assert.equal(code("or-2", date), "GENSX");
    assert.equal(code("or-3", date), "ORTHO");
    assert.equal(code("or-4", date), "MIXED");
    assert.equal(code("or-5", date), "MIXED");
    for (const id of ["or-6", "or-7", "or-8", "or-9", "or-13"]) assert.equal(allocationFor(id, date), null, `${id} ${date}`);
  }
  // Second half.
  assert.equal(code("or-10", SECOND_DAY), "MIXED");
  assert.equal(code("or-11", SECOND_DAY), "INFECT");
  assert.equal(code("or-12", SECOND_DAY), "GENSX");
  assert.equal(code("or-13", SECOND_DAY), "ORTHO");
  assert.equal(allocationFor("or-9", SECOND_DAY), null);
  assert.equal(allocationFor("or-2", SECOND_DAY), null);

  const allocation = allocationFor("or-2", FIRST_DAY)!;
  assert.equal(allocation.repair, true);
  assert.equal(allocation.split, false);
  assert.equal(allocation.am, allocation.pm);
  assert.equal(allocation.am?.color, REPAIR_COLOR, "the repair's colour, not the department's");
  assert.equal(allocation.am?.label, "GENSX", "the department's label");
  assert.equal(DEPARTMENTS.GENSX.color, "#0E5E6F", "the department list keeps its colour");
  assert.equal(readableTextOn(REPAIR_COLOR), "#ffffff");

  assert.equal(allocationFor("or-2", "2026-12-12"), null, "Saturday");
  assert.equal(allocationFor("or-4", BEFORE)?.repair, false);
  assert.equal(allocationFor("or-4", BEFORE)?.am?.code, "OBGYN", "the weekly schedule again before the repair");
  assert.equal(allocationFor("or-4", AFTER)?.am?.code, "OBGYN", "and after it");
});

test("a mixed-department room is labelled OTHER and named คละแผนก", () => {
  assert.equal(DEPARTMENTS.MIXED.label, "OTHER");
  assert.equal(DEPARTMENTS.MIXED.name, "คละแผนก");
});

test("cases can be added only to rooms that operate on the chosen day", () => {
  const ok = { operation: "ORIF radius", shift: "in" };
  const today = "2027-01-15";
  assert.equal(checkCase({ ...ok, date: FIRST_LAST, roomId: "or-2" }, today).ok, true);
  assert.equal(checkCase({ ...ok, date: FIRST_LAST, roomId: "or-12" }, today).ok, false);
  assert.equal(checkCase({ ...ok, date: SECOND_DAY, roomId: "or-12" }, today).ok, true);
  assert.equal(checkCase({ ...ok, date: SECOND_DAY, roomId: "or-2" }, today).ok, false);

  const recovery = checkCase({ ...ok, date: FIRST_LAST, roomId: "or-7" }, today);
  assert.ok(!recovery.ok);
  assert.match(recovery.error, /ห้องพักฟื้น/);
  const closed = checkCase({ ...ok, date: SECOND_DAY, roomId: "or-3" }, today);
  assert.ok(!closed.ok);
  assert.match(closed.error, /ปิด/);
});

test("a doctor's room follows the repair: own department's room, else a mixed-department room", () => {
  assert.equal(roomForSubtype("GENSX", "2026-12-14"), "or-2");
  assert.equal(roomForSubtype("ORTHO", "2026-12-14"), "or-3");
  assert.equal(roomForSubtype("URO", "2026-12-14"), "or-4");
  assert.equal(roomForSubtype("OBGYN", "2026-12-14"), "or-4");
  assert.equal(roomForSubtype("GENSX", SECOND_DAY), "or-12");
  assert.equal(roomForSubtype("ORTHO", SECOND_DAY), "or-13");
  assert.equal(roomForSubtype("EYE", SECOND_DAY), "or-10");
  assert.equal(roomForSubtype(null, SECOND_DAY), null);
  assert.equal(roomForSubtype("URO", BEFORE), null, "outside the repair there is no mixed room");
});

test("an added case in a room not operating that day stays off the board", () => {
  const added = (id: string, roomId: string): AddedCase => ({
    id,
    date: SECOND_DAY,
    roomId,
    operation: "x",
    shift: "in",
    surgeon: "ก ข",
    subtype: "GENSX",
  });
  const board = { key: "fri" as const, name: "Friday" as const, date: SECOND_DAY, operations: [] };
  const ops = withAddedCases(board, [added("1", "or-12"), added("2", "or-2"), added("3", "or-9")]).operations;
  assert.deepEqual(ops.map((item) => item.roomId), ["or-12"]);
});

function weekOf(days: string[], cases: Partial<WeekCase>[]): WeekFile {
  return {
    meta: { days, rows: 0, kept: 0, dropped: {} },
    cases: cases.map((item) => ({
      day: 0, dept: null, surgeon: "สมชาย กลับกลาย", title: "นพ.", proc: "x", status: "done",
      shift: null, emergency: false, ...item,
    })),
  };
}

test("imported cases follow the repair's rooms", () => {
  const cases: Partial<WeekCase>[] = [
    { proc: "Dressing wound", dept: "ORTHO" },
    { dept: "GENSX" },
    { dept: "ORTHO" },
    { dept: "EYE" },
    { dept: "SCOPE", proc: "colonoscopy" }, // not a GENSX surgeon's, so a general-surgery case
    { emergency: true, dept: "OBGYN" }, // no emergency room and no OBGYN room: a mixed room
  ];
  const first = weekBoard(weekOf(["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18"], cases))[0];
  assert.deepEqual(first.operations.map((item) => item.roomId), ["or-1", "or-2", "or-3", "or-4", "or-2", "or-5"]);
  const second = weekBoard(weekOf(["2027-01-25", "2027-01-26", "2027-01-27", "2027-01-28", "2027-01-29"], cases))[0];
  assert.deepEqual(second.operations.map((item) => item.roomId), ["or-11", "or-12", "or-13", "or-10", "or-12", "or-10"]);
});

test("the board's note names the half and its last day", () => {
  assert.equal(repairNote(repairOn(FIRST_DAY)!), "ปิดซ่อมห้องผ่าตัด ช่วงที่ 1 · ถึง 21 ม.ค. 2570");
  assert.equal(repairNote(repairOn(SECOND_DAY)!), "ปิดซ่อมห้องผ่าตัด ช่วงที่ 2 · ถึง 7 มี.ค. 2570");
  assert.equal(numberRanges([6, 7, 8, 10, 12, 13]), "6–8, 10, 12–13");
});
