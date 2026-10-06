import assert from "node:assert/strict";
import { test } from "node:test";
import { isTestMode, isUserAllowed } from "./allowlist.ts";
import { getRoom, isSelectableRoom, roomLabel } from "./rooms.ts";

test("allowlist is open until it contains ids", () => {
  assert.equal(isUserAllowed("U1", undefined, false), true);
  assert.equal(isUserAllowed("U1", "  ", false), true);
  assert.equal(isUserAllowed("U1", "U2, U1", false), true);
  assert.equal(isUserAllowed("U3", "U1,U2", false), false);
  assert.equal(isUserAllowed(undefined, "U1", false), false);
});

test("test mode lets every LINE account in, and AUTH_TEST_MODE=false turns it off", () => {
  assert.equal(isUserAllowed("U3", "U1,U2", true), true);
  assert.equal(isUserAllowed(undefined, "U1", true), true);
  assert.equal(isTestMode(undefined), true);
  assert.equal(isTestMode(""), true);
  assert.equal(isTestMode("true"), true);
  assert.equal(isTestMode("false"), false);
  assert.equal(isTestMode(" FALSE "), false);
});

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
