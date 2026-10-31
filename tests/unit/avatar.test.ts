import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { avatarSrc, initialOf } from "@/lib/avatar";

describe("avatar", () => {
  test("only https pictures on LINE's CDN are shown (as the CSP img-src allows)", () => {
    assert.equal(avatarSrc("https://profile.line-scdn.net/0hAbc"), "https://profile.line-scdn.net/0hAbc");
    assert.equal(avatarSrc("https://obs.line-scdn.net/x"), "https://obs.line-scdn.net/x");
    for (const bad of [
      null,
      undefined,
      "",
      "http://profile.line-scdn.net/0hAbc",
      "https://evil.test/x.png",
      "https://line-scdn.net.evil.test/x",
      "https://user:pw@profile.line-scdn.net/x",
      "https://profile.line-scdn.net:8443/x",
      "data:image/svg+xml,<svg/>",
      "javascript:alert(1)",
      `https://profile.line-scdn.net/${"a".repeat(1100)}`,
    ]) {
      assert.equal(avatarSrc(bad), null, String(bad));
    }
  });

  test("initial: first letter, skipping Thai leading vowels", () => {
    assert.equal(initialOf("ปิยะ ใจดี"), "ป");
    assert.equal(initialOf(" เฉลิมพล กินรี"), "ฉ");
    assert.equal(initialOf("ไพโรจน์"), "พ");
    assert.equal(initialOf("Somchai"), "S");
    assert.equal(initialOf("123"), "1");
    assert.equal(initialOf("   "), "•");
  });
});
