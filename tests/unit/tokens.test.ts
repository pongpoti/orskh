import "./_setup";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { SignJWT } from "jose";
import {
  openTx,
  sealTx,
  signAccess,
  signPending,
  signSession,
  verifyAccess,
  verifyPending,
  verifySession,
} from "@/lib/tokens";
import { TEST_SESSION_SECRET as SECRET } from "./_setup";

const user = { sub: "U123", email: "doc2@example.com", name: "หมอ <b>ทดสอบ</b>", picture: null };
const enc = new TextEncoder();

function b64json(part: string) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("session JWT", () => {
  test("round trip with HS256, 30 day expiry, issuer and audience", async () => {
    const token = await signSession(user, SECRET);
    const [h, p] = token.split(".");
    assert.equal(b64json(h).alg, "HS256");
    const payload = b64json(p);
    assert.equal(payload.aud, "session");
    assert.equal(payload.iss, "orskh");
    assert.ok(Math.abs(payload.exp - payload.iat - 30 * 24 * 3600) <= 1);
    assert.deepEqual(await verifySession(token, SECRET), user);
  });

  test("rejects wrong secret, tampering, expiry, alg none and garbage", async () => {
    const token = await signSession(user, SECRET);
    assert.equal(await verifySession(token, `${SECRET}x`), null);

    const [h, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...b64json(p), email: "boss@example.com" })).toString("base64url");
    assert.equal(await verifySession(`${h}.${forged}.${s}`, SECRET), null);

    const expired = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("U123")
      .setIssuer("orskh")
      .setAudience("session")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(enc.encode(SECRET));
    assert.equal(await verifySession(expired, SECRET), null);

    const none = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${p}.`;
    assert.equal(await verifySession(none, SECRET), null);

    assert.equal(await verifySession(undefined, SECRET), null);
    assert.equal(await verifySession("a.b.c", SECRET), null);
    assert.equal(await verifySession("x".repeat(5000), SECRET), null);
  });

  test("a token for another audience is not a session", async () => {
    const other = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("U123")
      .setIssuer("orskh")
      .setAudience("pending")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(enc.encode(SECRET));
    assert.equal(await verifySession(other, SECRET), null);
  });
});

describe("pending login token", () => {
  test("round trip and 15 minute expiry", async () => {
    const t = await signPending({ sub: "U1", name: "n", picture: null, next: "/x" }, SECRET);
    const payload = b64json(t.split(".")[1]);
    assert.ok(payload.exp - payload.iat <= 15 * 60);
    assert.deepEqual(await verifyPending(t, SECRET), { sub: "U1", name: "n", picture: null, next: "/x" });
  });

  test("pending and session tokens are not interchangeable", async () => {
    const pending = await signPending({ sub: "U1", name: "n", picture: null, next: "/" }, SECRET);
    const session = await signSession(user, SECRET);
    assert.equal(await verifySession(pending, SECRET), null);
    assert.equal(await verifyPending(session, SECRET), null);
  });
});

describe("access token (verified email, not authorized)", () => {
  const grant = { sub: "U9", name: "พยาบาล <i>x</i>", picture: null, email: "newcomer@example.com" };

  test("round trip with its own audience and a 12 hour expiry", async () => {
    const t = await signAccess(grant, SECRET);
    const payload = b64json(t.split(".")[1]);
    assert.equal(payload.aud, "access");
    assert.ok(Math.abs(payload.exp - payload.iat - 12 * 3600) <= 1);
    assert.deepEqual(await verifyAccess(t, SECRET), grant);
    assert.equal(await verifyAccess(t, `${SECRET}x`), null);
  });

  test("not interchangeable with session or pending tokens (different key and audience)", async () => {
    const access = await signAccess(grant, SECRET);
    assert.equal(await verifySession(access, SECRET), null);
    assert.equal(await verifyPending(access, SECRET), null);
    assert.equal(await verifyAccess(await signSession(user, SECRET), SECRET), null);
    assert.equal(await verifyAccess(await signPending({ sub: "U1", name: "n", picture: null, next: "/" }, SECRET), SECRET), null);
    // signed with the session key but claiming the access audience
    const forged = await new SignJWT({ email: grant.email })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("U9")
      .setIssuer("orskh")
      .setAudience("access")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(enc.encode(SECRET));
    assert.equal(await verifyAccess(forged, SECRET), null);
  });
});

describe("LINE transaction cookie (JWE)", () => {
  const tx = { state: "s".repeat(43), nonce: "n".repeat(43), verifier: "v".repeat(43), next: "/" };

  test("round trip; contents are encrypted", async () => {
    const t = await sealTx(tx, SECRET);
    assert.equal(t.split(".").length, 5);
    assert.ok(!t.includes(Buffer.from(tx.state).toString("base64url").slice(0, 20)));
    assert.deepEqual(await openTx(t, SECRET), tx);
  });

  test("rejects other secrets and modified tokens", async () => {
    const t = await sealTx(tx, SECRET);
    assert.equal(await openTx(t, `${SECRET}x`), null);
    const parts = t.split(".");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 1;
    parts[3] = ct.toString("base64url");
    assert.equal(await openTx(parts.join("."), SECRET), null);
    assert.equal(await openTx(await signSession(user, SECRET), SECRET), null);
  });
});

describe("scripts/dev-session.mjs", () => {
  test("prints a cookie the app accepts", async () => {
    const out = execFileSync(process.execPath, ["scripts/dev-session.mjs", "Doc2@Example.com", "ผู้ทดสอบ"], {
      env: { ...process.env, APP_URL: "http://localhost:3999", SESSION_SECRET: SECRET },
      encoding: "utf8",
    }).trim();
    assert.match(out, /^session=[\w-]+\.[\w-]+\.[\w-]+$/);
    const u = await verifySession(out.slice("session=".length), SECRET);
    assert.equal(u?.email, "doc2@example.com");
    assert.equal(u?.name, "ผู้ทดสอบ");
  });

  test("refuses when APP_URL is https", () => {
    const r = spawnSync(process.execPath, ["scripts/dev-session.mjs", "doc2@example.com"], {
      env: { ...process.env, APP_URL: "https://orskh.vercel.app", SESSION_SECRET: SECRET },
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0);
    assert.equal(r.stdout.trim(), "");
  });
});
