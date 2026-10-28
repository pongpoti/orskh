import "./_setup";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clientIp, isJsonRequest, isSameOrigin, safeEqual, safeNextPath } from "@/lib/security";

const APP = "https://orskh.vercel.app";

describe("safeNextPath (open redirect protection)", () => {
  test("keeps same-origin relative paths", () => {
    assert.equal(safeNextPath("/"), "/");
    assert.equal(safeNextPath("/rooms?day=mon"), "/rooms?day=mon");
    assert.equal(safeNextPath("/a/b"), "/a/b");
    assert.equal(safeNextPath("/a/../b?x=1"), "/b?x=1");
    assert.equal(safeNextPath("/./b"), "/b");
  });
  test("rejects everything else", () => {
    for (const bad of [
      "https://evil.test/",
      "//evil.test",
      "/\\evil.test",
      "\\\\evil.test",
      "javascript:alert(1)",
      "evil.test",
      "/%0d%0aSet-Cookie:x",
      "/a\nb",
      "/login",
      "/login/verify",
      "/api/auth/logout",
      "/.//evil.test",
      "/..//evil.test",
      "/%2e//evil.test",
      "/%2E%2E//evil.test",
      "/a/..//evil.test",
      "/a/b/../..//evil.test",
      "/./\\evil.test",
      "",
      undefined,
      ["/"],
    ]) {
      const out = safeNextPath(bad);
      assert.ok(out === "/" || (out.startsWith("/") && !out.startsWith("//")), `bad: ${String(bad)} -> ${out}`);
      if (typeof bad === "string" && !bad.startsWith("/%0")) assert.equal(out, "/", `bad: ${bad}`);
    }
  });
});

describe("isSameOrigin (CSRF)", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  test("accepts matching Origin, or Referer when Origin is absent", () => {
    assert.equal(isSameOrigin(h({ origin: APP }), APP), true);
    assert.equal(isSameOrigin(h({ referer: `${APP}/login/verify` }), APP), true);
  });
  test("rejects missing, null, foreign or look-alike origins", () => {
    assert.equal(isSameOrigin(h({}), APP), false);
    assert.equal(isSameOrigin(h({ origin: "null" }), APP), false);
    assert.equal(isSameOrigin(h({ origin: "https://evil.test" }), APP), false);
    assert.equal(isSameOrigin(h({ origin: `${APP}.evil.test` }), APP), false);
    assert.equal(isSameOrigin(h({ origin: "https://evil.test", referer: `${APP}/` }), APP), false);
    assert.equal(isSameOrigin(h({ referer: "https://evil.test/?u=" + APP }), APP), false);
    assert.equal(isSameOrigin(h({ referer: "not a url" }), APP), false);
  });
});

describe("misc helpers", () => {
  test("isJsonRequest", () => {
    assert.equal(isJsonRequest(new Headers({ "content-type": "application/json" })), true);
    assert.equal(isJsonRequest(new Headers({ "content-type": "application/json; charset=utf-8" })), true);
    assert.equal(isJsonRequest(new Headers({ "content-type": "text/plain" })), false);
    assert.equal(isJsonRequest(new Headers({ "content-type": "application/x-www-form-urlencoded" })), false);
    assert.equal(isJsonRequest(new Headers({ "content-type": "application/jsonp" })), false);
    assert.equal(isJsonRequest(new Headers()), false);
  });
  test("clientIp prefers x-real-ip, then first x-forwarded-for", () => {
    assert.equal(clientIp(new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" })), "1.2.3.4");
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" })), "5.6.7.8");
    assert.equal(clientIp(new Headers()), "unknown");
  });
  test("safeEqual", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "abd"), false);
    assert.equal(safeEqual("abc", "abcd"), false);
    assert.equal(safeEqual("", ""), true);
  });
});
