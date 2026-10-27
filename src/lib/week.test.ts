import assert from "node:assert/strict";
import { test } from "node:test";
import { WEEK_DATA } from "../data/week-data.ts";
import { boardHref, DAY_KEYS, DAY_NAMES, parseDay, thaiDate, todayIso, weekDates, workdayIndex } from "./days.ts";
import { boardFor, isDressingCase, isScopeCase, resolveSurgeon, weekBoard, type WeekCase, type WeekFile } from "./week.ts";

function fixture(cases: Partial<WeekCase>[]): WeekFile {
  return {
    meta: { days: ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"], rows: 0, kept: 0, dropped: {} },
    cases: cases.map((item) => ({
      day: 0, dept: null, surgeon: "สมชาย กลับกลาย", title: "นพ.", proc: "x", status: "done",
      shift: null, emergency: false, ...item,
    })),
  };
}
const GENSX_SURGEON = "ขจรศักดิ์ โภคสมบัติ";
const roomsOf = (data: WeekFile, day = 0) => weekBoard(data)[day].operations.map((item) => item.roomId);

test("the export week runs Monday to Friday", () => {
  assert.deepEqual([...DAY_NAMES], ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  assert.deepEqual([...DAY_KEYS], ["mon", "tue", "wed", "thu", "fri"]);
  assert.deepEqual(weekBoard().map((day) => day.name), [...DAY_NAMES]);
  assert.deepEqual(weekBoard(fixture([])).map((day) => day.date), ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.deepEqual(weekDates("2026-10-29"), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
  assert.deepEqual(weekDates("2026-11-01"), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]); // Sunday
  assert.deepEqual(weekDates("2026-12-31"), ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"]); // across the year end
  assert.equal(parseDay(undefined), null);
  assert.equal(parseDay("nope"), null);
  assert.equal(parseDay("tue"), 1);
  assert.equal(parseDay(" FRI "), 4);
});

test("shows today's date in Thailand and that weekday's cases", () => {
  // 17:30 UTC on Monday is already Tuesday in Bangkok.
  assert.equal(todayIso(new Date("2026-10-26T17:30:00Z")), "2026-10-27");
  assert.equal(todayIso(new Date("2026-10-26T16:59:00Z")), "2026-10-26");
  assert.equal(workdayIndex("2026-10-26"), 0);
  assert.equal(workdayIndex("2026-10-30"), 4);
  assert.equal(workdayIndex("2026-10-31"), null);
  assert.equal(workdayIndex("2026-11-01"), null);
  assert.equal(thaiDate("2026-10-27"), "วันอังคารที่ 27 ตุลาคม 2569");
  assert.equal(thaiDate("2026-11-26", "short"), "วันพฤหัสบดีที่ 26 พ.ย. 2569");
  assert.equal(boardFor("2026-10-27")?.key, "tue");
  assert.equal(boardFor("2026-10-31"), null);
  assert.equal(boardFor("2026-10-31", 2)?.key, "wed");
});

test("builds room links and keeps other parameters", () => {
  assert.equal(boardHref(null), "/");
  assert.equal(boardHref("or-3"), "/?room=or-3");
  assert.equal(boardHref(null, "/preview", "?day=thu&room=or-2"), "/preview?day=thu");
  assert.equal(boardHref("or-9", "/preview", "?day=fri"), "/preview?day=fri&room=or-9");
});

test("no case data is loaded, so today's board is empty and follows this week's allocation", () => {
  assert.equal(WEEK_DATA.cases.length, 0);
  assert.deepEqual(WEEK_DATA.meta.days, []);
  const today = boardFor("2026-10-27");
  assert.equal(today?.date, "2026-10-27");
  assert.deepEqual(today?.operations, []);
  assert.equal(boardFor("2026-10-27", 4)?.date, "2026-10-30"); // the preview's ?day=fri shows this week's Friday
});

test("every placed case lands in an OR", () => {
  const data = fixture([{ dept: "GENSX" }, { day: 2, dept: "ORTHO" }, { day: 4, dept: "EYE", proc: "dressing" }]);
  for (const day of weekBoard(data)) {
    for (const item of day.operations) assert.match(item.roomId, /^or-(1[0-3]|[1-9])$/);
  }
  assert.equal(weekBoard(data).reduce((sum, day) => sum + day.operations.length, 0), 3);
});

test("keeps no patient fields in the case data", () => {
  const allowed = new Set(["day", "dept", "surgeon", "title", "proc", "status", "shift", "emergency"]);
  for (const item of WEEK_DATA.cases) {
    for (const key of Object.keys(item)) assert.ok(allowed.has(key), key);
    assert.doesNotMatch(`${item.proc} ${item.surgeon}`, /(นาย|นางสาว|นาง |น\.ส\.|\bHN\b|\bAN\b|\d{6,})/);
  }
});

test("rooms follow the report's rules", () => {
  const data = fixture([
    { proc: "Dressing wound", dept: "GENSX" },
    { emergency: true, dept: "ORTHO" },
    { emergency: true, dept: "OBGYN" },
    { dept: "EYE" },
    { dept: "ORTHO" },
    { dept: "GENSX", surgeon: GENSX_SURGEON, proc: "colonoscopy" },
  ]);
  // Monday: dressing OR 1, emergency OR 8, OBGYN stays in one of its own rooms, EYE OR 11, ORTHO OR 12 or 13, SCOPE OR 3.
  const rooms = roomsOf(data);
  assert.equal(rooms[0], "or-1");
  assert.equal(rooms[1], "or-8");
  assert.ok(["or-4", "or-6"].includes(rooms[2]), rooms[2]);
  assert.equal(rooms[3], "or-11");
  assert.ok(["or-12", "or-13"].includes(rooms[4]), rooms[4]);
  assert.equal(rooms[5], "or-3");
});

test("a department with several rooms is pooled across them", () => {
  // GENSX holds OR 2 and OR 5 on Monday.
  const rooms = roomsOf(fixture([{ dept: "GENSX" }, { dept: "GENSX" }, { dept: "GENSX" }, { dept: "GENSX" }]));
  assert.equal(rooms.filter((room) => room === "or-2").length, 2);
  assert.equal(rooms.filter((room) => room === "or-5").length, 2);
});

test("a case whose department holds no room that day is left off the board", () => {
  // Cardiothoracic surgery has no room on Tuesday.
  const day = weekBoard(fixture([{ day: 1, dept: "CVT" }, { day: 1, dept: "GENSX" }]))[1];
  assert.equal(day.operations.length, 1);
  assert.notEqual(day.operations[0].roomId, "");
  assert.deepEqual(day.operations.map((item) => item.order), [1]);
});

test("orders each room's cases and tells the surgeon's department", () => {
  const day = weekBoard(fixture([{ dept: "GENSX", surgeon: GENSX_SURGEON, proc: "EGD" }, { dept: "GENSX", surgeon: GENSX_SURGEON, proc: "ERCP" }, { dept: "GENSX", surgeon: GENSX_SURGEON, proc: "hernia" }]))[0];
  assert.deepEqual(day.operations.map((item) => [item.roomId, item.order]), [["or-3", 1], ["or-3", 2], ["or-2", 1]]);
  assert.equal(day.operations[0].specialty, "ศัลยกรรม · GENSX");
});

test("matches surgeons to the physician list, including a spelling variant", () => {
  assert.deepEqual(resolveSurgeon("สมชาย  กลับกลาย", "นพ."), { label: "นพ. สมชาย กลับกลาย", specialty: "ศัลยกรรม · URO", team: "URO" });
  assert.equal(resolveSurgeon("วันทนันท์ หล่อวัฒนกิจชัย", "นพ.").label, "นพ. วันทนันท์ หล่อวัฒนากิจชัย");
  assert.equal(resolveSurgeon("วันทนันท์ หล่อวัฒนกิจชัย", "นพ.").specialty, "ศัลยกรรมออร์โธปิดิกส์");
  assert.deepEqual(resolveSurgeon("ไม่มี ในรายชื่อ", "พญ."), { label: "พญ. ไม่มี ในรายชื่อ", specialty: null, team: null });
});

test("ignores a room the export names and places the case by the schedule", () => {
  // Monday OR 4 is OBGYN; the case is general surgery, so it lands in a general-surgery room whatever the file says.
  const data = fixture([{ dept: "GENSX", room: 4 } as Partial<WeekCase>]);
  assert.ok(["or-2", "or-5"].includes(roomsOf(data)[0]));
});

test("the SCOPE room takes only a GENSX surgeon's endoscopic cases", () => {
  for (const name of ["EGD", "OGD under GA", "Gastroscopy", "Esophagoscopy", "colonoscopy+polypectomy", "Sigmoidoscopy", "ERCP", "Endoscopic sphincterotomy", "EUS"]) {
    assert.ok(isScopeCase(name, "GENSX"), name);
  }
  assert.equal(isScopeCase("BEGD", "GENSX"), false); // \b: whole word only
  // foreign-body removal is excluded, and so is anyone who is not labelled GENSX
  for (const name of ["remove FB by EGD", "Remove  fb", "foreign body removal gastroscopy", "FB esophagus"]) {
    assert.equal(isScopeCase(name, "GENSX"), false, name);
  }
  assert.equal(isScopeCase("colonoscopy", "URO"), false);
  assert.equal(isScopeCase("colonoscopy", null), false);
  assert.equal(isScopeCase("hernia repair", "GENSX"), false);
});

test("a case in the SCOPE room is always a GENSX surgeon's endoscopic case", () => {
  const data = fixture([
    { dept: "GENSX", surgeon: GENSX_SURGEON, proc: "colonoscopy" }, // qualifies
    { dept: "GENSX", surgeon: GENSX_SURGEON, proc: "remove FB by EGD" }, // foreign body: general-surgery room
    { dept: "GENSX", surgeon: GENSX_SURGEON, proc: "hernia" }, // not endoscopic
    { dept: "GENSX", surgeon: "สมชาย กลับกลาย", proc: "colonoscopy" }, // URO surgeon
  ]);
  const rooms = roomsOf(data);
  assert.equal(rooms[0], "or-3");
  assert.ok(["or-2", "or-5"].includes(rooms[1]), rooms[1]);
  assert.ok(["or-2", "or-5"].includes(rooms[2]), rooms[2]);
  assert.notEqual(rooms[3], "or-3");
});

test("finds dressing cases by the hospital's keyword algorithm", () => {
  for (const name of ["Dressing wound OD", "change vac dressing", "Change vac d/s", "D / S wound", "ds wound", "DW", "vacc d", "ทำแผล", "ล้างแผลที่ขา", "เปลี่ยนแผล"]) {
    assert.ok(isDressingCase(name), name);
  }
  // another procedure in the name, or d/s, ds and dw inside a longer word, is not a dressing case
  for (const name of ["debridement and dressing", "DB", "d.b. wound", "scrub and dressing", "STSG dressing", "suture wound", "closure with dressing", "excision lesion dw", "amputation d/s", "hernia repair", "adsorb", "midwife dwell"]) {
    assert.equal(isDressingCase(name), false, name);
  }
});

test("OR 1 takes dressing cases from any department and nothing else", () => {
  const data = fixture([
    { dept: "ORTHO", proc: "Dressing wound" },
    { dept: "URO", proc: "change vac dressing", emergency: true }, // dressing is checked before emergency
    { dept: "GENSX", proc: "debridement and dressing" },
  ]);
  const rooms = roomsOf(data);
  assert.equal(rooms[0], "or-1");
  assert.equal(rooms[1], "or-1");
  assert.notEqual(rooms[2], "or-1");
});
