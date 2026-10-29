import "./_setup";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatPhone, isAllowedPhone, normalizePhone, parsePhoneList, PHONE_RE, toInternational } from "@/lib/phone";
import { normalizePhone as rosterNormalizePhone, PHONE_RE as ROSTER_PHONE_RE } from "../../scripts/physicians-roster.mjs";

describe("phone normalization", () => {
  test("accepts 0XXXXXXXXX, 66XXXXXXXXX and +66XXXXXXXXX with spaces, dashes, dots and parentheses", () => {
    for (const input of [
      "0812345678",
      "081-234-5678",
      " 081 234 5678 ",
      "081.234.5678",
      "(081) 234-5678",
      "66812345678",
      "+66812345678",
      "+66 81 234 5678",
      "+66-81-234-5678",
      "๐๘๑๒๓๔๕๖๗๘", // Thai digits
      "０８１２３４５６７８", // full-width digits (NFKC)
      "081 234 5678", // no-break spaces
      "081–234–5678", // en dashes
      "(+66) 81-234-5678",
      "+66 (0) 81 234 5678", // business cards: the 0 kept after the country code
      "+66 081-234-5678",
      "660812345678",
    ]) {
      assert.equal(normalizePhone(input), "0812345678", JSON.stringify(input));
    }
    assert.equal(normalizePhone("0612345678"), "0612345678");
    assert.equal(normalizePhone("0912345678"), "0912345678");
    assert.equal(normalizePhone("+66612345678"), "0612345678");
  });

  test("rejects landlines, wrong lengths, other countries and anything else", () => {
    for (const bad of [
      "",
      "021234567", // Bangkok landline
      "0212345678", // 02 is not a mobile range
      "0712345678", // 07 is not a mobile range
      "0512345678",
      "081234567", // 9 digits
      "08123456789", // 11 digits
      "6681234567", // 66 + 8 digits
      "+6608123456789", // +66, the leading 0, then 10 digits
      "+66 0 712345678", // the 0 kept, but 07 is not a mobile range
      "66012345678", // 660 + 8 digits
      "+6581234567", // Singapore
      "+1 812 345 6789",
      "0812345678x",
      "08l2345678", // letter l
      "08/12345678",
      "0812345678;",
      "1".repeat(41),
      null,
      42,
      812345678,
      { phone: "0812345678" },
    ]) {
      assert.equal(normalizePhone(bad), null, `should reject ${JSON.stringify(bad)}`);
    }
  });

  test("formats for display and for the provider", () => {
    assert.equal(formatPhone("0812345678"), "081-234-5678");
    assert.equal(formatPhone("0611111111"), "061-111-1111");
    assert.equal(formatPhone("not a phone"), "not a phone");
    assert.equal(toInternational("0812345678"), "66812345678");
    assert.equal(toInternational("0900000001"), "66900000001");
    assert.ok(PHONE_RE.test("0900000001"));
  });

  test("list parsing tolerates commas, semicolons, newlines and spaces inside a number", () => {
    const set = parsePhoneList(" 081-234-5678, +66900000002;\n061 111 1111 ,, not-a-number, 021234567 ");
    assert.deepEqual([...set].sort(), ["0611111111", "0812345678", "0900000002"]);
  });

  test("isAllowedPhone uses ALLOWED_PHONES and normalizes both sides", () => {
    assert.equal(isAllowedPhone("0812345678"), true);
    assert.equal(isAllowedPhone("+66 81 234 5678"), true);
    assert.equal(isAllowedPhone("0900000002"), true);
    assert.equal(isAllowedPhone("0611111111"), true);
    assert.equal(isAllowedPhone("0812345679"), false);
    assert.equal(isAllowedPhone("garbage"), false);
  });

  test("allowlist changes are picked up; a missing or empty list (it is optional) allows nobody, quietly", () => {
    const saved = process.env.ALLOWED_PHONES;
    const logged: unknown[] = [];
    const orig = [console.error, console.warn];
    console.error = console.warn = (...a: unknown[]) => void logged.push(a);
    try {
      process.env.ALLOWED_PHONES = "0900000009";
      assert.equal(isAllowedPhone("090-000-0009"), true);
      assert.equal(isAllowedPhone("0812345678"), false);
      delete process.env.ALLOWED_PHONES;
      assert.equal(isAllowedPhone("0900000009"), false);
      process.env.ALLOWED_PHONES = " ";
      assert.equal(isAllowedPhone("0900000009"), false);
      assert.equal(isAllowedPhone(" "), false);
    } finally {
      process.env.ALLOWED_PHONES = saved;
      [console.error, console.warn] = orig;
    }
    assert.deepEqual(logged, []);
  });

  test("scripts/physicians-roster.mjs uses the same pattern and normalization", () => {
    assert.equal(ROSTER_PHONE_RE.source, PHONE_RE.source);
    assert.equal(ROSTER_PHONE_RE.flags, PHONE_RE.flags);
    // the sync script must store exactly what the app looks up
    for (const input of [
      "0812345678",
      "081-234-5678",
      " 081 234 5678 ",
      "(081) 234-5678",
      "081.234.5678",
      "66812345678",
      "+66812345678",
      "+66 81 234 5678",
      "๐๘๑๒๓๔๕๖๗๘",
      "０８１２３４５６７８",
      "081 234 5678",
      "081–234–5678",
      "\t0612345678\n",
      "0212345678",
      "081234567",
      "08123456789",
      "+660812345678",
      "+66 (0) 81 234 5678",
      "+66 081-234-5678",
      "(+66) 81-234-5678",
      "+6608123456789",
      "6681234567",
      "08l2345678",
      " ".repeat(30) + "0812345678", // 40 characters: accepted
      " ".repeat(31) + "0812345678", // 41: over the limit
      "",
    ]) {
      assert.equal(rosterNormalizePhone(input), normalizePhone(input), JSON.stringify(input));
    }
  });
});
