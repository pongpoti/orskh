import assert from "node:assert/strict";
import { test } from "node:test";
import { getRoom, isClosedRoom, isOpenRoom, isSelectableRoom, openRooms, roomLabel } from "./rooms.ts";

test("rooms have kinds and zones", () => {
  assert.equal(getRoom("or-7")?.zone, 2);
  assert.equal(getRoom("r-2")?.kind, "recovery");
  assert.equal(getRoom("lift"), null);
});

test("open OR rooms are selectable and labeled OR N", () => {
  const or5 = getRoom("or-5");
  const rr1 = getRoom("r-1");
  assert.equal(roomLabel(or5!), "OR 5");
  assert.equal(roomLabel(rr1!), "RR 1");
  assert.equal(isSelectableRoom(or5!), true);
  assert.equal(isSelectableRoom(rr1!), false);
});

test("OR 1 to 5 are open and OR 6 to 13 are closed", () => {
  assert.deepEqual(
    openRooms().map((room) => room.id),
    ["or-1", "or-2", "or-3", "or-4", "or-5"],
  );
  for (let n = 6; n <= 13; n += 1) {
    const room = getRoom(`or-${n}`)!;
    assert.equal(isClosedRoom(room), true, `OR ${n}`);
    assert.equal(isSelectableRoom(room), false, `OR ${n}`);
    assert.equal(isOpenRoom(room.id), false, `OR ${n}`);
  }
  assert.equal(isClosedRoom(getRoom("r-1")!), false);
});
