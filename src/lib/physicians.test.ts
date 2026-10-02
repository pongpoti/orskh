import assert from "node:assert/strict";
import { test } from "node:test";
import { getPhysician, listPhysicians, PHYSICIAN_GROUPS } from "./physicians.ts";

test("physician list matches the supplied departments", () => {
  const counts = Object.fromEntries(PHYSICIAN_GROUPS.map((group) => [group.id, group.names.length]));
  assert.deepEqual(counts, {
    surgery: 33,
    orthopedic: 15,
    obgyn: 13,
    ent: 8,
    eye: 7,
  });
  const people = listPhysicians();
  assert.equal(people.length, 76);
  assert.equal(new Set(people.map((person) => person.id)).size, 76);
  assert.equal(getPhysician("orthopedic-1")?.name, "เฉลิมพล กินรี");
  assert.equal(getPhysician("missing"), null);
});
