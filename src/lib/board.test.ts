import assert from "node:assert/strict";
import { test } from "node:test";
import { getRoom, isSelectableRoom, roomLabel } from "./rooms.ts";

test("rooms have kinds and zones", () => {
  assert.equal(getRoom("or-7")?.zone, 2);
  assert.equal(getRoom("r-2")?.kind, "recovery");
  assert.equal(getRoom("lift"), null);
});

test("OR rooms are selectable and labeled OR N", () => {
  const or7 = getRoom("or-7");
  const rr1 = getRoom("r-1");
  assert.equal(roomLabel(or7!), "OR 7");
  assert.equal(roomLabel(rr1!), "RR 1");
  assert.equal(isSelectableRoom(or7!), true);
  assert.equal(isSelectableRoom(rr1!), false);
});
