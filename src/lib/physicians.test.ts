import assert from "node:assert/strict";
import { test } from "node:test";
import { getPhysician, listPhysicians, PHYSICIAN_GROUPS } from "./physicians.ts";

test("physician list matches the supplied departments", () => {
  const counts = Object.fromEntries(PHYSICIAN_GROUPS.map((group) => [group.id, group.names.length]));
  assert.deepEqual(counts, {
    pediatrics: 20,
    eye: 7,
    psychiatry: 5,
    "clinical-pathology": 1,
    forensic: 2,
    opd: 7,
    "anatomical-pathology": 4,
    radiology: 1,
    anesthesia: 8,
    rehab: 4,
    "social-medicine": 1,
    emergency: 10,
    surgery: 34,
    orthopedic: 15,
    obgyn: 13,
    ent: 7,
    occupational: 2,
    internal: 34,
    intern: 46,
  });
  const people = listPhysicians();
  assert.equal(people.length, 221);
  assert.equal(new Set(people.map((person) => person.id)).size, 221);
  assert.equal(getPhysician("orthopedic-1")?.name, "เฉลิมพล กินรี");
  assert.equal(getPhysician("surgery-1")?.name, "กิตติ์พงส์ ชมภูพงษ์เกษม");
  assert.equal(getPhysician("anesthesia-1")?.name, "ชลวรรณ ชุ่มแจ้ง");
  assert.equal(getPhysician("anesthesia-8")?.name, "รวิจิต ชวิตรานุรักษ์");
  assert.equal(getPhysician("intern-46")?.name, "อลีนา ภัณฑ์กิจนิรันดร");
  assert.equal(getPhysician("missing"), null);
});
