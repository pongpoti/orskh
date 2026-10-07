import assert from "node:assert/strict";
import { test } from "node:test";
import { getPhysician, listPhysicians, MEDICINE_TEAMS, PHYSICIAN_GROUPS, SURGICAL_TEAMS, teamOf } from "./physicians.ts";

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
    surgery: 33,
    orthopedic: 15,
    obgyn: 13,
    ent: 8,
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

test("knows each general-surgery sub-specialty team", () => {
  assert.equal(teamOf("พีรวิชญ์ ศรียารันต์"), "CVT");
  assert.equal(teamOf("พีรวิชญ์ ส่งศิริ"), "PEDSX");
  assert.equal(teamOf("ฐิติกร หอทิมาวรกุล"), "URO");
  assert.equal(teamOf("ขจรศักดิ์ โภคสมบัติ"), "GENSX"); // no sub-specialty listed
  assert.equal(teamOf("เฉลิมพล กินรี"), null); // not in the surgery group
  const all = Object.values(SURGICAL_TEAMS).flat() as string[];
  assert.equal(all.length, 22);
  const surgeons = new Set(PHYSICIAN_GROUPS.find((group) => group.id === "surgery")?.names);
  for (const name of all) assert.ok(surgeons.has(name), name);
});

test("knows the internal-medicine nephrology team", () => {
  assert.equal(teamOf("อนุพงษ์ ธนัญภูวสิษฏ์"), "NEPHRO");
  assert.equal(teamOf("อรพรรณ เลิศสาครประเสริฐ"), "NEPHRO");
  assert.equal(teamOf("วิชิต กาจเงิน"), null);
  const internal = new Set(PHYSICIAN_GROUPS.find((group) => group.id === "internal")?.names);
  for (const name of MEDICINE_TEAMS.NEPHRO) assert.ok(internal.has(name), name);
  assert.equal(MEDICINE_TEAMS.NEPHRO.length, 4);
});

test("labels every obstetrician-gynaecologist OBGYN", () => {
  const group = PHYSICIAN_GROUPS.find((item) => item.id === "obgyn");
  assert.equal(group?.names.length, 13);
  for (const name of group?.names ?? []) assert.equal(teamOf(name), "OBGYN", name);
});
