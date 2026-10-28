import "./_setup";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EMAIL_RE, isAllowedEmail, normalizeEmail, parseAllowlist } from "@/lib/email";
import { normalizeEmail as rosterNormalizeEmail, EMAIL_RE as ROSTER_EMAIL_RE } from "../../scripts/physicians-roster.mjs";

describe("email normalization", () => {
  test("trims, lowercases and applies NFKC", () => {
    assert.equal(normalizeEmail("  Doc.One@Example.COM \n"), "doc.one@example.com");
    // full-width characters (common with Thai/Asian keyboards) fold to ASCII
    assert.equal(normalizeEmail("ｄｏｃ２＠ｅｘａｍｐｌｅ．ｃｏｍ"), "doc2@example.com");
  });

  test("rejects malformed or oversized input", () => {
    for (const bad of [
      "",
      "plain",
      "a@b",
      "a@@example.com",
      "a b@example.com",
      "<a>@example.com",
      "a@example..com",
      "a@-example.com",
      `${"a".repeat(250)}@example.com`,
      "หมอ@example.com",
      null,
      42,
      { email: "a@example.com" },
    ]) {
      assert.equal(normalizeEmail(bad), null, `should reject ${JSON.stringify(bad)}`);
    }
  });

  test("allowlist parsing tolerates case, spaces, semicolons and newlines", () => {
    const set = parseAllowlist(" A@Example.com, b@example.com;\nC@EXAMPLE.COM ,, not-an-email ");
    assert.deepEqual([...set].sort(), ["a@example.com", "b@example.com", "c@example.com"]);
  });

  test("isAllowedEmail uses ALLOWED_EMAILS and normalizes both sides", () => {
    assert.equal(isAllowedEmail("doc.one@example.com"), true);
    assert.equal(isAllowedEmail(" DOC2@EXAMPLE.COM "), true);
    assert.equal(isAllowedEmail("third@example.com"), true);
    assert.equal(isAllowedEmail("intruder@example.com"), false);
    assert.equal(isAllowedEmail("doc2@example.com.evil.test"), false);
  });

  test("allowlist changes are picked up; a missing or empty list (it is optional) allows nobody, quietly", () => {
    const saved = process.env.ALLOWED_EMAILS;
    const logged: unknown[] = [];
    const orig = [console.error, console.warn];
    console.error = console.warn = (...a: unknown[]) => void logged.push(a);
    try {
      process.env.ALLOWED_EMAILS = "new@example.com";
      assert.equal(isAllowedEmail("new@example.com"), true);
      assert.equal(isAllowedEmail("doc2@example.com"), false);
      delete process.env.ALLOWED_EMAILS;
      assert.equal(isAllowedEmail("new@example.com"), false);
      process.env.ALLOWED_EMAILS = " ";
      assert.equal(isAllowedEmail("new@example.com"), false);
      assert.equal(isAllowedEmail(" "), false);
    } finally {
      process.env.ALLOWED_EMAILS = saved;
      [console.error, console.warn] = orig;
    }
    assert.deepEqual(logged, []);
  });

  test("scripts/physicians-roster.mjs uses the same address pattern and normalization", () => {
    assert.equal(ROSTER_EMAIL_RE.source, EMAIL_RE.source);
    assert.equal(ROSTER_EMAIL_RE.flags, EMAIL_RE.flags);
    // the sync script must store exactly what the app looks up
    const at = (n: number) => `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(n - 197)}.com`;
    assert.equal(at(254).length, 254);
    assert.equal(normalizeEmail(at(254)), at(254), "longest accepted");
    assert.equal(normalizeEmail(at(255)), null, "one too long");
    for (const input of [
      "  Doc.One@Example.COM \n",
      "ｄｏｃ２＠ｅｘａｍｐｌｅ．ｃｏｍ",
      "doc\u00A0@example.com",
      "\u00A0doc@example.com\t",
      "o'neil+or@example.co.th",
      "a@b.co",
      "a@b",
      "ab",
      "plain",
      "a b@example.com",
      "หมอ@example.com",
      at(254),
      at(255),
      ` ${at(254).toUpperCase()} `,
      `${" ".repeat(300)}a@example.com`, // 313 before trimming
      `${" ".repeat(310)}a@example.com`, // 323: over 320
      "",
    ]) {
      assert.equal(rosterNormalizeEmail(input), normalizeEmail(input), JSON.stringify(input));
    }
  });
});
