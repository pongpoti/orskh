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
  assert.equal(normaliseName("สมชาย​กลับกลาย"), "สมชายกลับกลาย");
  assert.equal(normaliseName("สมชาย กลับกลาย"), "สมชาย กลับกลาย");
  assert.equal(normaliseName("﻿\t"), "");
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
  const seeded = [...sql.matchAll(/^  \('([^']+)', '([A-Z]+)'\),?$/gm)].map(([, name, specialty]) => ({ name, specialty }));
  assert.deepEqual(seeded, SURGEONS.map(({ name, specialty }) => ({ name, specialty })));
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM surgeons\)/, "only an empty table is seeded");
});
