import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { adminIds, isAdmin } from "./admin.ts";
import { SURGEONS } from "../data/surgeons.ts";
import { checkSurgeon, isSurgeonId, normaliseName, sortSurgeons } from "./surgeons.ts";

test("only the LINE ids in AUTH_ADMIN_LINE_IDS are admins", () => {
  const raw = " U111 , U222,, ";
  assert.deepEqual(adminIds(raw), ["U111", "U222"]);
  assert.equal(isAdmin("U111", raw), true);
  assert.equal(isAdmin("U222", raw), true);
  assert.equal(isAdmin("U333", raw), false);
  assert.equal(isAdmin("U11", raw), false); // no partial matches
  assert.equal(isAdmin("", raw), false);
  assert.equal(isAdmin(undefined, raw), false);
  // Unset or empty: nobody, not everybody.
  assert.equal(isAdmin("U111", ""), false);
  assert.equal(isAdmin("U111", " , "), false);
  assert.deepEqual(adminIds(""), []);
});

test("names are evened out before they are compared or saved", () => {
  assert.equal(normaliseName("  สมชาย   กลับกลาย "), "สมชาย กลับกลาย");
  assert.equal(normaliseName("สมชาย\u200Bกลับกลาย"), "สมชายกลับกลาย");
  assert.equal(normaliseName("สมชาย\u00A0กลับกลาย"), "สมชาย กลับกลาย");
  assert.equal(normaliseName("\uFEFF\t"), "");
  // Other pasted format characters: direction marks, soft hyphens, bidi controls.
  assert.equal(normaliseName("สมชาย กลับกลาย\u200E"), "สมชาย กลับกลาย");
  assert.equal(normaliseName("สม\u00ADชาย\u202A กลับกลาย"), "สมชาย กลับกลาย");
  assert.equal(normaliseName("\u00AD\u200F"), "");
  // NFC comes last: a dropped zero-width space between two marks still gives the same name as typing it.
  assert.equal(normaliseName("ช\u0E48\u200B\u0E38ม"), normaliseName("ช\u0E38\u0E48ม"));
  assert.equal(normaliseName("Ame\u200B\u0301lie"), "Am\u00E9lie");
  // Thai vowels and tone marks are kept.
  assert.equal(normaliseName("ปองสิทธิ์ โพธิคุณ"), "ปองสิทธิ์ โพธิคุณ");
});

test("a surgeon needs a name and one of the listed specialties", () => {
  assert.deepEqual(checkSurgeon(" สมชาย  ใจดี ", "URO"), { ok: true, name: "สมชาย ใจดี", specialty: "URO" });
  assert.equal(checkSurgeon("   ", "URO").ok, false);
  assert.equal(checkSurgeon(undefined, "URO").ok, false);
  assert.equal(checkSurgeon(42, "URO").ok, false);
  assert.equal(checkSurgeon("สมชาย ใจดี", "").ok, false);
  assert.equal(checkSurgeon("สมชาย ใจดี", "VASCULAR").ok, false); // the code is VAS
  assert.equal(checkSurgeon("สมชาย ใจดี", "NEPHRO").ok, false); // a department, but not a surgical specialty
  assert.equal(checkSurgeon("ก".repeat(121), "URO").ok, false);
  assert.equal(checkSurgeon("ก".repeat(120), "URO").ok, true);
});

test("row ids from the page must be positive whole numbers", () => {
  assert.equal(isSurgeonId(1), true);
  for (const id of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined]) assert.equal(isSurgeonId(id), false, String(id));
});

test("the list is grouped by specialty, then by name; unknown codes go last", () => {
  const list = sortSurgeons([
    { name: "ข", specialty: "URO" },
    { name: "ก", specialty: "EYE" },
    { name: "ก", specialty: "URO" },
    { name: "ค", specialty: "OLD" },
    { name: "ง", specialty: "GENSX" },
  ]);
  assert.deepEqual(list.map((item) => `${item.specialty} ${item.name}`), ["GENSX ง", "URO ก", "URO ข", "EYE ก", "OLD ค"]);
});

test("the seed list is clean: valid specialties and no repeated names", () => {
  const names = new Set<string>();
  for (const person of SURGEONS) {
    const checked = checkSurgeon(person.name, person.specialty);
    assert.ok(checked.ok, person.name);
    assert.equal(checked.name, person.name, "seed names are already normalised");
    assert.ok(!names.has(person.name), `${person.name} is listed twice`);
    names.add(person.name);
  }
  assert.equal(names.size, 76);
});

test("the migration seeds exactly the supplied list", () => {
  const sql = readFileSync(new URL("../../drizzle/0001_surgeons.sql", import.meta.url), "utf8");
  const seeded = [...sql.matchAll(/^ {6}\('([^']+)', '([A-Z]+)'\)[,;]$/gm)].map(([, name, specialty]) => ({ name, specialty }));
  assert.deepEqual(seeded, SURGEONS.map(({ name, specialty }) => ({ name, specialty })));
  // Seeded once: only while the id sequence has never handed out a value, so deleting every row does not reseed.
  // The check sits in an IF, not a WHERE, so it is not re-run after the first row goes in.
  assert.match(sql, /IF pg_sequence_last_value\(pg_get_serial_sequence\('surgeons', 'id'\)\) IS NULL THEN/);
  assert.doesNotMatch(sql, /WHERE pg_sequence_last_value/);
});
