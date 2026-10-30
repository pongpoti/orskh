// Shared test configuration. Modules read env lazily, so setting process.env here is enough.
import { randomBytes } from "node:crypto";
import { assertDisposableUsersSync, assertLocalTestDatabase } from "../db-guard.mjs";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/orskh_test";
// The tests drop and truncate tables (users among them): refuse a remote database (unless ALLOW_REMOTE_TEST_DB=1) and
// one whose users table holds real data. Every test file imports this module first, so this runs before any DROP.
assertLocalTestDatabase(TEST_DB, "TEST_DATABASE_URL");
assertDisposableUsersSync(TEST_DB, "TEST_DATABASE_URL");
export const TEST_SESSION_SECRET = randomBytes(32).toString("base64url");
export const TEST_PEPPER = randomBytes(24).toString("base64url");

export function setTestEnv(): void {
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.AUTH_LINE_ID;
  delete process.env.AUTH_LINE_SECRET;
  Object.assign(process.env, {
    APP_URL: "http://localhost:3999",
    SESSION_SECRET: TEST_SESSION_SECRET,
    OTP_PEPPER: TEST_PEPPER,
    // break-glass list in three spellings: dashes, +66, spaces
    ALLOWED_PHONES: " 081-234-5678,+66900000002 ;\n 061 111 1111 ",
    LINE_CHANNEL_ID: "1234567890",
    LINE_CHANNEL_SECRET: "test-line-secret",
    DATABASE_URL: TEST_DB,
    SMS_PROVIDER: "console",
  });
}

setTestEnv();
