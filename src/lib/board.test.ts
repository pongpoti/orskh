import assert from "node:assert/strict";
import { test } from "node:test";
import { getRoom, isClosedRoom, isOpenRoom, isSelectableRoom, openRooms, roomLabel } from "./rooms.ts";

test("rooms have kinds and zones", () => {
  assert.equal(getRoom("or-7")?.zone, 2);
  assert.equal(getRoom("r-2")?.kind, "recovery");
  assert.equal(getRoom("lift"), null);
});

// Wednesday 4 November 2026, before the ventilation repair.
const NOV = "2026-11-04";

test("open OR rooms are selectable and labeled OR N", () => {
  const or5 = getRoom("or-5");
  const rr1 = getRoom("r-1");
  assert.equal(roomLabel(or5!), "OR 5");
  assert.equal(roomLabel(rr1!), "RR 1");
  assert.equal(isSelectableRoom(or5!, NOV), true);
  assert.equal(isSelectableRoom(rr1!, NOV), false);
});

test("outside the repair OR 1 to 5 are open and OR 6 to 13 are closed", () => {
  for (const date of [NOV, "2026-12-07", "2027-03-08"]) {
    assert.deepEqual(
      openRooms(date).map((room) => room.id),
      ["or-1", "or-2", "or-3", "or-4", "or-5"],
      date,
    );
    for (let n = 6; n <= 13; n += 1) {
      const room = getRoom(`or-${n}`)!;
      assert.equal(isClosedRoom(room, date), true, `OR ${n} ${date}`);
      assert.equal(isSelectableRoom(room, date), false, `OR ${n} ${date}`);
      assert.equal(isOpenRoom(room.id, date), false, `OR ${n} ${date}`);
    }
  }
  assert.equal(isClosedRoom(getRoom("r-1")!, NOV), false);
});
