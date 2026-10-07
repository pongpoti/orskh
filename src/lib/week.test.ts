import assert from "node:assert/strict";
import { test } from "node:test";
import { WEEK_DATA } from "../data/week-data.ts";
import { boardHref, DAY_KEYS, DAY_NAMES, parseDay } from "./days.ts";
import { resolveSurgeon, weekBoard, type WeekCase, type WeekFile } from "./week.ts";

function fixture(cases: Partial<WeekCase>[]): WeekFile {
  return {
    meta: { days: ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"], rows: 0, kept: 0, dropped: {} },
    cases: cases.map((item) => ({
      day: 0, room: null, dept: null, surgeon: "สมชาย กลับกลาย", title: "นพ.", proc: "x", status: "done",
      shift: null, dressing: false, emergency: false, ...item,
    })),
  };
}
const roomsOf = (data: WeekFile, day = 0) => weekBoard(data)[day].operations.map((item) => item.roomId);

test("shows Monday to Friday, Monday first", () => {
  assert.deepEqual([...DAY_NAMES], ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  assert.deepEqual(weekBoard().map((day) => day.name), [...DAY_NAMES]);
  assert.deepEqual(weekBoard().map((day) => day.date), ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.equal(parseDay(undefined), 0);
  assert.equal(parseDay("nope"), 0);
  assert.equal(parseDay("tue"), 1);
  assert.equal(parseDay(" FRI "), 4);
});

test("builds day links that keep Monday implicit", () => {
  assert.equal(boardHref("mon"), "/");
  assert.equal(boardHref("mon", "or-3"), "/?room=or-3");
  assert.equal(boardHref("thu", null, "/preview"), "/preview?day=thu");
  assert.equal(boardHref("fri", "or-9"), "/?day=fri&room=or-9");
  assert.deepEqual([...DAY_KEYS], ["mon", "tue", "wed", "thu", "fri"]);
});

test("every kept case from the export lands on a day, and nearly all in a room", () => {
  const days = weekBoard();
  const total = days.reduce((sum, day) => sum + day.operations.length + day.unplaced.length, 0);
  assert.equal(total, WEEK_DATA.cases.length);
  assert.equal(total, WEEK_DATA.meta.kept);
  assert.equal(WEEK_DATA.meta.rows - Object.values(WEEK_DATA.meta.dropped).reduce((a, b) => a + b, 0), total);
  assert.ok(days.reduce((sum, day) => sum + day.unplaced.length, 0) <= 3);
  for (const day of days) {
    for (const item of day.operations) assert.match(item.roomId, /^or-(1[0-3]|[1-9])$/);
  }
});

test("keeps no patient fields in the case data", () => {
  const allowed = new Set(["day", "room", "dept", "surgeon", "title", "proc", "status", "shift", "dressing", "emergency"]);
  for (const item of WEEK_DATA.cases) {
    for (const key of Object.keys(item)) assert.ok(allowed.has(key), key);
    assert.doesNotMatch(`${item.proc} ${item.surgeon}`, /(นาย|นางสาว|นาง |น\.ส\.|\bHN\b|\bAN\b|\d{6,})/);
  }
});

test("a room the export recorded is kept, whatever the allocation says", () => {
  // EYE holds OR 10, but this case was done in OR 11.
  assert.deepEqual(roomsOf(fixture([{ room: 11, dept: "EYE" }])), ["or-11"]);
});

test("rooms the export left blank follow the report's rules", () => {
  const data = fixture([
    { dressing: true, dept: "GENSX" },
    { emergency: true, dept: "ORTHO" },
    { emergency: true, dept: "OBGYN" },
    { dept: "EYE" },
    { dept: "ORTHO" },
    { dept: "SCOPE" },
  ]);
  // Monday: dressing OR 1, emergency OR 8, OBGYN stays in one of its own rooms, EYE OR 10, ORTHO OR 11, SCOPE OR 3.
  const rooms = roomsOf(data);
  assert.equal(rooms[0], "or-1");
  assert.equal(rooms[1], "or-8");
  assert.ok(["or-4", "or-6", "or-7"].includes(rooms[2]), rooms[2]);
  assert.equal(rooms[3], "or-10");
  assert.equal(rooms[4], "or-11");
  assert.equal(rooms[5], "or-3");
});

test("a department with several rooms is pooled across them", () => {
  // GENSX holds OR 2 and OR 5 on Monday.
  const rooms = roomsOf(fixture([{ dept: "GENSX" }, { dept: "GENSX" }, { dept: "GENSX" }, { dept: "GENSX" }]));
  assert.equal(rooms.filter((room) => room === "or-2").length, 2);
  assert.equal(rooms.filter((room) => room === "or-5").length, 2);
});

test("cases with no possible room are set aside, not lost", () => {
  // Urology has no room on Tuesday.
  const day = weekBoard(fixture([{ day: 1, dept: "URO" }]))[1];
  assert.equal(day.operations.length, 0);
  assert.equal(day.unplaced.length, 1);
});

test("orders each room's cases and tells the surgeon's department", () => {
  const day = weekBoard(fixture([{ room: 3, proc: "a" }, { room: 3, proc: "b" }, { room: 2, proc: "c" }]))[0];
  assert.deepEqual(day.operations.map((item) => [item.roomId, item.order]), [["or-3", 1], ["or-3", 2], ["or-2", 1]]);
  assert.equal(day.operations[0].specialty, "ศัลยกรรม");
});

test("matches surgeons to the physician list, including a spelling variant", () => {
  assert.deepEqual(resolveSurgeon("สมชาย  กลับกลาย", "นพ."), { label: "นพ. สมชาย กลับกลาย", specialty: "ศัลยกรรม" });
  assert.equal(resolveSurgeon("วันทนันท์ หล่อวัฒนกิจชัย", "นพ.").label, "นพ. วันทนันท์ หล่อวัฒนากิจชัย");
  assert.equal(resolveSurgeon("วันทนันท์ หล่อวัฒนกิจชัย", "นพ.").specialty, "ศัลยกรรมออร์โธปิดิกส์");
  assert.deepEqual(resolveSurgeon("ไม่มี ในรายชื่อ", "พญ."), { label: "พญ. ไม่มี ในรายชื่อ", specialty: null });
});

test("flags a case placed in a room its department does not hold that day", () => {
  const data = fixture([
    { room: 4, dept: "GENSX" }, // OR 4 is OBGYN on Monday
    { room: 4, dept: "OBGYN" },
    { room: 3, dept: "GENSX" }, // SCOPE room, same general-surgery team
    { room: 8, dept: "GENSX" }, // emergency room takes any department
    { room: 1, dept: "ORTHO" }, // dressing room too
    { room: 4, dept: null },
  ]);
  assert.deepEqual(weekBoard(data)[0].operations.map((item) => item.offSchedule), [true, false, false, false, false, false]);
});
