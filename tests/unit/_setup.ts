// Shared test configuration. Modules read env lazily, so setting process.env here is enough.
import { randomBytes } from "node:crypto";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/orskh_test";
export const TEST_SESSION_SECRET = randomBytes(32).toString("base64url");
export const TEST_PEPPER = randomBytes(24).toString("base64url");

export function setTestEnv(): void {
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  Object.assign(process.env, {
    APP_URL: "http://localhost:3999",
    SESSION_SECRET: TEST_SESSION_SECRET,
    OTP_PEPPER: TEST_PEPPER,
    ALLOWED_EMAILS: " Doc.One@Example.com,doc2@example.com ;\n third@example.com ",
    LINE_CHANNEL_ID: "1234567890",
    LINE_CHANNEL_SECRET: "test-line-secret",
    DATABASE_URL: TEST_DB,
    EMAIL_TRANSPORT: "console",
  });
}

setTestEnv();
