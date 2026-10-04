import assert from "node:assert/strict";
import { test } from "node:test";
import { isUserAllowed } from "./allowlist.ts";
import { parseBoardDate, shiftDate } from "./dates.ts";
import { getRoom, isSelectableRoom, roomLabel } from "./rooms.ts";
import { casesForRoom, getSchedule, roomMark } from "./schedule.ts";

const now = new Date("2026-10-02T03:00:00.000Z");

test("parses a calendar date and falls back to Bangkok today", () => {
  assert.equal(parseBoardDate("2026-01-15", now), "2026-01-15");
  assert.equal(parseBoardDate(undefined, now), "2026-10-02");
  assert.equal(parseBoardDate("nope", now), "2026-10-02");
  assert.equal(parseBoardDate("2026-02-31", now), "2026-10-02");
});

test("shifts calendar dates across month boundaries", () => {
  assert.equal(shiftDate("2026-10-31", 1), "2026-11-01");
  assert.equal(shiftDate("2026-01-01", -1), "2025-12-31");
});

test("allowlist is open until it contains ids", () => {
  assert.equal(isUserAllowed("U1", undefined), true);
  assert.equal(isUserAllowed("U1", "  "), true);
  assert.equal(isUserAllowed("U1", "U2, U1"), true);
  assert.equal(isUserAllowed("U3", "U1,U2"), false);
  assert.equal(isUserAllowed(undefined, "U1"), false);
});

test("sample schedule marks rooms and keeps names off the list", () => {
  const day = getSchedule("2026-10-02");
  assert.equal(day.length, 12);
  assert.equal(roomMark(casesForRoom(day, "or-7")), "active");
  assert.equal(roomMark(casesForRoom(day, "or-11")), "delayed");
  assert.equal(roomMark(casesForRoom(day, "or-2")), null);
  assert.equal(roomMark(casesForRoom(day, "r-1")), "active");
  assert.equal(getRoom("or-7")?.zone, 2);
  assert.equal(getRoom("r-2")?.kind, "recovery");
  assert.equal(getRoom("lift"), null);
  for (const item of day) {
    assert.equal("patient" in item, false);
  }
});

test("OR rooms are selectable and labeled OR N", () => {
  const or7 = getRoom("or-7");
  const rr1 = getRoom("r-1");
  assert.equal(roomLabel(or7!), "OR 7");
  assert.equal(roomLabel(rr1!), "RR 1");
  assert.equal(isSelectableRoom(or7!), true);
  assert.equal(isSelectableRoom(rr1!), false);
});
