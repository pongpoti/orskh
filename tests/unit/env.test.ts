import "./_setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { cookieName, cookieOptions } from "@/lib/cookies";
import { allowedPhonesRaw, appUrl, assertOtpReady, ConfigError, lineConfig, smsConfig } from "@/lib/env";
import { setTestEnv } from "./_setup";

afterEach(() => setTestEnv());

describe("env validation", () => {
  test("reports missing variable NAMES only, never values", () => {
    delete process.env.OTP_PEPPER;
    delete process.env.DATABASE_URL;
    process.env.SESSION_SECRET = "short-secret-value";
    process.env.SMS_PROVIDER = "deesmsx";
    delete process.env.DEESMSX_API_KEY;
    delete process.env.DEESMSX_SECRET_KEY;
    try {
      assertOtpReady();
      assert.fail("expected ConfigError");
    } catch (e) {
      assert.ok(e instanceof ConfigError);
      assert.deepEqual(e.names.sort(), ["DATABASE_URL", "DEESMSX_API_KEY", "DEESMSX_SECRET_KEY", "OTP_PEPPER", "SESSION_SECRET"]);
      assert.ok(!e.message.includes("short-secret-value"));
    }
  });

  test("ALLOWED_PHONES (break-glass list) is optional", () => {
    delete process.env.ALLOWED_PHONES;
    assertOtpReady();
    assert.equal(allowedPhonesRaw(), "");
    process.env.ALLOWED_PHONES = "  ";
    assertOtpReady();
    assert.equal(allowedPhonesRaw(), "");
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

  test("LINE channel: the old Auth.js names AUTH_LINE_ID / AUTH_LINE_SECRET still work; the new names win", () => {
    delete process.env.LINE_CHANNEL_ID;
    delete process.env.LINE_CHANNEL_SECRET;
    assert.throws(
      () => lineConfig(),
      (e: unknown) => e instanceof ConfigError && e.names.join() === "LINE_CHANNEL_ID,LINE_CHANNEL_SECRET",
      "reported under the new names",
    );
    process.env.AUTH_LINE_ID = "1111111111";
    process.env.AUTH_LINE_SECRET = "old-line-secret";
    let c = lineConfig();
    assert.equal(c.channelId, "1111111111");
    assert.equal(c.channelSecret, "old-line-secret");
    process.env.LINE_CHANNEL_ID = "2222222222";
    process.env.LINE_CHANNEL_SECRET = "new-line-secret";
    c = lineConfig();
    assert.equal(c.channelId, "2222222222");
    assert.equal(c.channelSecret, "new-line-secret");
  });

  test("SMS: local modes for development, only deeSMSX on Vercel", () => {
    process.env.SMS_PROVIDER = "file";
    process.env.SMS_OUTBOX_DIR = "/tmp/outbox";
    assert.equal(smsConfig().kind, "file");
    process.env.SMS_PROVIDER = "console";
    assert.equal(smsConfig().kind, "console");
    delete process.env.SMS_PROVIDER;
    assert.throws(() => smsConfig(), (e: unknown) => e instanceof ConfigError && e.names.includes("DEESMSX_API_KEY"), "deesmsx by default");
    process.env.SMS_PROVIDER = "file";
    process.env.VERCEL = "1";
    assert.throws(() => smsConfig(), (e: unknown) => e instanceof ConfigError && e.names.includes("DEESMSX_SECRET_KEY"));
    process.env.DEESMSX_API_KEY = "api-key";
    process.env.DEESMSX_SECRET_KEY = "secret-key";
    process.env.DEESMSX_SENDER = "ORSKH";
    const m = smsConfig();
    assert.equal(m.kind, "deesmsx");
    assert.equal(m.sender, "ORSKH");
    assert.equal(m.dailyCap, 300);
    delete process.env.DEESMSX_API_KEY;
    delete process.env.DEESMSX_SECRET_KEY;
    delete process.env.DEESMSX_SENDER;
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
