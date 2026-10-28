import "./_setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { cookieName, cookieOptions } from "@/lib/cookies";
import { allowedEmailsRaw, appUrl, assertOtpReady, ConfigError, lineConfig, mailConfig } from "@/lib/env";
import { setTestEnv } from "./_setup";

afterEach(() => setTestEnv());

describe("env validation", () => {
  test("reports missing variable NAMES only, never values", () => {
    delete process.env.OTP_PEPPER;
    delete process.env.DATABASE_URL;
    process.env.SESSION_SECRET = "short-secret-value";
    process.env.EMAIL_TRANSPORT = "smtp";
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    try {
      assertOtpReady();
      assert.fail("expected ConfigError");
    } catch (e) {
      assert.ok(e instanceof ConfigError);
      assert.deepEqual(e.names.sort(), ["DATABASE_URL", "OTP_PEPPER", "SESSION_SECRET", "SMTP_PASS", "SMTP_USER"]);
      assert.ok(!e.message.includes("short-secret-value"));
    }
  });

  test("ALLOWED_EMAILS (break-glass list) is optional", () => {
    delete process.env.ALLOWED_EMAILS;
    assertOtpReady();
    assert.equal(allowedEmailsRaw(), "");
    process.env.ALLOWED_EMAILS = "  ";
    assertOtpReady();
    assert.equal(allowedEmailsRaw(), "");
  });

  test("APP_URL is reduced to its origin", () => {
    process.env.APP_URL = "https://orskh.vercel.app/some/path";
    assert.equal(appUrl().toString(), "https://orskh.vercel.app/");
    process.env.APP_URL = "ftp://x";
    assert.throws(() => appUrl(), ConfigError);
  });

  test("LINE endpoints: real by default, dev overrides honoured locally, ignored on Vercel", () => {
    delete process.env.LINE_AUTH_URL;
    delete process.env.LINE_API_URL;
    let c = lineConfig();
    assert.equal(c.authorizeUrl, "https://access.line.me/oauth2/v2.1/authorize");
    assert.equal(c.tokenUrl, "https://api.line.me/oauth2/v2.1/token");
    assert.equal(c.verifyUrl, "https://api.line.me/oauth2/v2.1/verify");
    assert.equal(c.redirectUri, "http://localhost:3999/api/auth/line/callback");

    process.env.LINE_AUTH_URL = "http://localhost:4010/oauth2/v2.1/authorize";
    process.env.LINE_API_URL = "http://localhost:4010/";
    c = lineConfig();
    assert.equal(c.authorizeUrl, "http://localhost:4010/oauth2/v2.1/authorize");
    assert.equal(c.tokenUrl, "http://localhost:4010/oauth2/v2.1/token");

    process.env.VERCEL = "1";
    c = lineConfig();
    assert.equal(c.authorizeUrl, "https://access.line.me/oauth2/v2.1/authorize");
    assert.equal(c.verifyUrl, "https://api.line.me/oauth2/v2.1/verify");
  });

  test("mail transport: dev transports locally, SMTP only on Vercel", () => {
    process.env.EMAIL_TRANSPORT = "file";
    process.env.EMAIL_OUTBOX_DIR = "/tmp/outbox";
    assert.equal(mailConfig().kind, "file");
    process.env.VERCEL = "1";
    assert.throws(() => mailConfig(), (e: unknown) => e instanceof ConfigError && e.names.includes("SMTP_USER"));
    process.env.SMTP_USER = "sender@example.com";
    process.env.SMTP_PASS = "app-password";
    const m = mailConfig();
    assert.equal(m.kind, "smtp");
    assert.equal(m.host, "smtp.gmail.com");
    assert.equal(m.port, 465);
    assert.match(m.from, /^"ORSKH\.APP ตารางห้องผ่าตัด" <sender@example\.com>$/);
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  test("cookie names: __Host- prefix + Secure on https, plain on http", () => {
    process.env.APP_URL = "https://orskh.vercel.app";
    assert.equal(cookieName("session"), "__Host-session");
    assert.deepEqual(cookieOptions("session"), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 3600,
    });
    process.env.APP_URL = "http://localhost:3000";
    assert.equal(cookieName("session"), "session");
    assert.equal(cookieOptions("tx").secure, false);
    assert.equal(cookieOptions("tx").maxAge, 600);
    assert.equal(cookieOptions("pending").maxAge, 900);
    assert.equal(cookieName("access"), "access");
    assert.equal(cookieOptions("access").maxAge, 12 * 3600);
    process.env.APP_URL = "https://orskh.vercel.app";
    assert.equal(cookieName("access"), "__Host-access");
    assert.equal(cookieOptions("access").httpOnly, true);
  });
});
