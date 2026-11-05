import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, checkCase, cleanOperation, MAX_OPERATION, nextWorkday, roomForSubtype, withAddedCases, type AddedCase } from "./added-cases.ts";
import type { DayBoard } from "./week.ts";

// Tuesday 4 November 2026.
const TODAY = "2026-11-04";
const ok = { date: TODAY, roomId: "or-2", operation: "Laparoscopic cholecystectomy", shift: "in" };

test("a good case passes, cleaned", () => {
  const checked = checkCase({ ...ok, operation: "  Lap ​chole\n  " }, TODAY);
  assert.deepEqual(checked, { ok: true, value: { ...ok, operation: "Lap chole" } });
  assert.equal(cleanOperation("a\t b"), "a b");
});

test("the shift defaults to in hours and must be in or out", () => {
  const checked = checkCase({ date: ok.date, roomId: ok.roomId, operation: ok.operation }, TODAY);
  assert.ok(checked.ok);
  assert.equal(checked.value.shift, "in");
  assert.equal(checkCase({ ...ok, shift: "night" }, TODAY).ok, false);
});

test("dates: today up to 60 days ahead, weekdays only", () => {
  assert.equal(checkCase({ ...ok, date: "2026-11-03" }, TODAY).ok, false); // yesterday
  assert.equal(checkCase({ ...ok, date: "2026-11-07" }, TODAY).ok, false); // Saturday
  assert.equal(checkCase({ ...ok, date: "2026-11-02x" }, TODAY).ok, false);
  assert.equal(checkCase({ ...ok, date: "2026-02-30" }, TODAY).ok, false);
  assert.equal(checkCase({ ...ok, date: addDays(TODAY, 61) }, TODAY).ok, false);
  assert.equal(checkCase({ ...ok, date: "2026-11-05" }, TODAY).ok, true);
});

test("every OR (1 to 13) takes a case; recovery-area rooms and unknown ids do not", () => {
  for (const roomId of ["or-1", "or-3", "or-5", "or-6", "or-8", "or-13"]) assert.equal(checkCase({ ...ok, roomId }, TODAY).ok, true, roomId);
  for (const roomId of ["r-1", "", "x"]) assert.equal(checkCase({ ...ok, roomId }, TODAY).ok, false, roomId);
});

test("the operation is required and at most 300 characters", () => {
  assert.equal(checkCase({ ...ok, operation: "   " }, TODAY).ok, false);
  assert.equal(checkCase({ ...ok, operation: 5 }, TODAY).ok, false);
  assert.equal(checkCase({ ...ok, operation: "x".repeat(MAX_OPERATION) }, TODAY).ok, true);
  assert.equal(checkCase({ ...ok, operation: "x".repeat(MAX_OPERATION + 1) }, TODAY).ok, false);
  assert.equal(checkCase(null, TODAY).ok, false);
});

test("next workday and the department's room", () => {
  assert.equal(nextWorkday("2026-11-07"), "2026-11-09");
  assert.equal(nextWorkday("2026-11-04"), "2026-11-04");
  assert.equal(roomForSubtype("GENSX", "2026-11-02"), "or-2"); // Monday
  // The weekly schedule's rooms (lib/repair.test.ts covers the stored repair layout).
  assert.equal(roomForSubtype("ENT", "2026-10-28"), "or-4"); // Wednesday
  assert.equal(roomForSubtype("PEDSX", "2026-10-13"), "or-5"); // 2nd Tuesday
  assert.equal(roomForSubtype("URO", "2026-10-28"), "or-7"); // Wednesday
  assert.equal(roomForSubtype("EYE", "2026-11-05"), "or-11"); // Thursday
  assert.equal(roomForSubtype(null, "2026-10-28"), null);
});

test("added cases join the board after its own, numbered per room", () => {
  const board: DayBoard = {
    key: "wed",
    name: "Wednesday",
    date: TODAY,
    operations: [
      { id: "a", roomId: "or-2", order: 1, procedure: "EGD", surgeon: "x", specialty: null, status: "scheduled", shift: "in" },
    ],
  };
  const base = { operation: "Op", shift: "in" as const, surgeon: "สมชาย ใจดี", subtype: "ORTHO" };
  const added: AddedCase[] = [
    { ...base, id: "1", date: TODAY, roomId: "or-2" },
    { ...base, id: "2", date: TODAY, roomId: "or-3", shift: "out" },
    { ...base, id: "3", date: "2026-11-05", roomId: "or-2" }, // another day
    { ...base, id: "4", date: TODAY, roomId: "or-9" },
    { ...base, id: "5", date: TODAY, roomId: "or-2" },
  ];
  const ops = withAddedCases(board, added).operations;
  assert.deepEqual(
    ops.map((item) => [item.id, item.roomId, item.order, item.shift]),
    [
      ["a", "or-2", 1, "in"],
      ["case-1", "or-2", 2, "in"],
      ["case-2", "or-3", 1, "out"],
      ["case-4", "or-9", 1, "in"],
      ["case-5", "or-2", 3, "in"],
    ],
  );
  assert.equal(ops[1].specialty, "ออร์โธปิดิกส์");
  assert.equal(ops[1].surgeon, "สมชาย ใจดี");
  assert.equal(board.operations.length, 1, "the board itself is not changed");
});
