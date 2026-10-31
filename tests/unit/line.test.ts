import "./_setup";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { lineConfig } from "@/lib/env";
import {
  buildAuthorizeUrl,
  cleanDisplayName,
  cleanPictureUrl,
  createPkce,
  pkceChallenge,
  verifyIdToken,
} from "@/lib/line";

describe("PKCE and authorize URL", () => {
  test("S256 challenge = unpadded base64url(SHA-256(verifier))", () => {
    const v = "dBjftJeZ4CVP-mJ92K-ze7lGk6iGL0h7hhGHAVUkdGw";
    const expected = createHash("sha256").update(v).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    assert.equal(pkceChallenge(v), expected);
    assert.match(pkceChallenge(v), /^[A-Za-z0-9_-]{43}$/);
    const { verifier, challenge } = createPkce();
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(challenge, pkceChallenge(verifier));
  });

  test("authorize URL carries every required parameter", () => {
    delete process.env.LINE_AUTH_URL;
    const u = new URL(buildAuthorizeUrl(lineConfig(), { state: "st", nonce: "no", challenge: "ch" }));
    assert.equal(u.origin + u.pathname, "https://access.line.me/oauth2/v2.1/authorize");
    assert.deepEqual(Object.fromEntries(u.searchParams), {
      response_type: "code",
      client_id: "1234567890",
      redirect_uri: "http://localhost:3999/api/auth/line/callback",
      state: "st",
      scope: "profile openid",
      nonce: "no",
      code_challenge: "ch",
      code_challenge_method: "S256",
      ui_locales: "th",
    });
  });
});

describe("LINE profile sanitizing", () => {
  test("display name: strips control and bidi characters, keeps text as-is, caps length", () => {
    assert.equal(cleanDisplayName("  หมอ‮สมชาย\u0000 "), "หมอสมชาย");
    assert.equal(cleanDisplayName("<script>alert(1)</script>"), "<script>alert(1)</script>");
    assert.equal(cleanDisplayName("x".repeat(500)).length, 100);
    assert.equal(cleanDisplayName(42), "");
  });
  test("picture: only https on *.line-scdn.net", () => {
    assert.equal(cleanPictureUrl("https://profile.line-scdn.net/0habc"), "https://profile.line-scdn.net/0habc");
    assert.equal(cleanPictureUrl("https://obs.line-scdn.net/x"), "https://obs.line-scdn.net/x");
    for (const bad of [
      "http://profile.line-scdn.net/x",
      "https://evil.test/x",
      "https://line-scdn.net.evil.test/x",
      "javascript:alert(1)",
      "https://user:pw@profile.line-scdn.net/x",
      null,
    ]) {
      assert.equal(cleanPictureUrl(bad), null, String(bad));
    }
  });
});

describe("verifyIdToken against a stub verify endpoint", () => {
  let server: Server;
  let claims: Record<string, unknown> = {};
  let status = 200;
  let lastForm: URLSearchParams | null = null;

  before(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        lastForm = new URLSearchParams(body);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(status === 200 ? claims : { error: "invalid_request" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    process.env.LINE_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => {
    server.close();
    delete process.env.LINE_API_URL;
  });

  const good = () => ({
    iss: "https://access.line.me",
    sub: "U0123456789abcdef",
    aud: "1234567890",
    exp: Math.floor(Date.now() / 1000) + 600,
    iat: Math.floor(Date.now() / 1000),
    nonce: "the-nonce",
    name: "หมอ‮ ทดสอบ",
    picture: "https://profile.line-scdn.net/0habc",
  });

  test("accepts valid claims and posts id_token, client_id, nonce", async () => {
    claims = good();
    status = 200;
    const p = await verifyIdToken(lineConfig(), "id.token.here", "the-nonce");
    assert.deepEqual(p, { sub: "U0123456789abcdef", name: "หมอ ทดสอบ", picture: "https://profile.line-scdn.net/0habc" });
    assert.equal(lastForm?.get("id_token"), "id.token.here");
    assert.equal(lastForm?.get("client_id"), "1234567890");
    assert.equal(lastForm?.get("nonce"), "the-nonce");
  });

  test("rejects wrong iss, aud, expired token, nonce mismatch, bad sub and HTTP errors", async () => {
    status = 200;
    const cases: Array<[string, Record<string, unknown>]> = [
      ["iss", { ...good(), iss: "https://evil.test" }],
      ["aud", { ...good(), aud: "999" }],
      ["exp", { ...good(), exp: Math.floor(Date.now() / 1000) - 1 }],
      ["nonce", { ...good(), nonce: "other" }],
      ["sub", { ...good(), sub: "../etc" }],
    ];
    for (const [name, c] of cases) {
      claims = c;
      await assert.rejects(verifyIdToken(lineConfig(), "t", "the-nonce"), Error, name);
    }
    status = 400;
    await assert.rejects(verifyIdToken(lineConfig(), "t", "the-nonce"), /HTTP 400/);
  });
});
