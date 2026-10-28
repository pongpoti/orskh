#!/usr/bin/env node
// DEV ONLY. Usage: node scripts/dev-session.mjs <email> [display name]
// Prints "name=value" of a valid session cookie signed with SESSION_SECRET from env/.env.local.
// Token format must match signSession() in lib/tokens.ts. Refuses when APP_URL is https or on Vercel.
import { SignJWT } from "jose";
import { loadEnvLocal } from "./load-env.mjs";

const env = loadEnvLocal();
const [rawEmail, name = "ผู้ทดสอบ (dev)"] = process.argv.slice(2);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!rawEmail) fail("usage: node scripts/dev-session.mjs <email> [display name]");
if (env.VERCEL) fail("refusing to run on Vercel");
let app;
try {
  app = new URL(env.APP_URL ?? "");
} catch {
  fail("APP_URL is missing or invalid");
}
if (app.protocol !== "http:") fail("refusing: APP_URL is not http:// (dev-session is for local development only)");
const secret = env.SESSION_SECRET ?? "";
if (secret.length < 32) fail("SESSION_SECRET is missing or shorter than 32 characters");

const email = rawEmail.normalize("NFKC").trim().toLowerCase();
const allowed = new Set(
  (env.ALLOWED_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.normalize("NFKC").trim().toLowerCase())
    .filter(Boolean),
);
// Outside the break-glass list the app needs the database to accept the session (lib/authz.ts).
if (!allowed.has(email)) {
  console.error(
    "note: the app accepts this session only while the email has an active row in the physicians table (or an " +
      "approved access request); add it to ALLOWED_EMAILS in .env.local to work without a database",
  );
}

const token = await new SignJWT({ email, name, picture: null })
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setSubject(`dev-${email}`)
  .setIssuer("orskh")
  .setAudience("session")
  .setIssuedAt()
  .setExpirationTime("30d")
  .sign(new TextEncoder().encode(secret));

// http APP_URL -> non-prefixed cookie name (see lib/cookies.ts)
console.log(`session=${token}`);
