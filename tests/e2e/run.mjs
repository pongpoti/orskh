#!/usr/bin/env node
// End-to-end sign-in tests: mock LINE (+ mock Telegram) + production build (next start) + Playwright (Chromium).
// Configurable so several copies can run in parallel:
//   E2E_APP_PORT (3100)  E2E_LINE_PORT (4010)  E2E_DATABASE_URL (postgres://postgres:postgres@localhost:5432/orskh_e2e)
//   E2E_OUTBOX_DIR (tmp)  E2E_SCREENS_DIR (tmp)  E2E_SKIP_BUILD=1 (reuse .next)
// The database's sign-in tables are dropped first (the built app creates them again on first use), then the physician
// list (table physicians) is loaded with scripts/sync-physicians.mjs from a roster CSV in a new temp folder.
// Only example.com addresses and invented names are used. Keep E2E_SCREENS_DIR outside the repository.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { SignJWT } from "jose";
import { repoRoot } from "../../scripts/load-env.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const pg = require("pg");

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
const LINE_PORT = Number(process.env.E2E_LINE_PORT ?? 4010);
const DB_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/orskh_e2e";
const OUTBOX = process.env.E2E_OUTBOX_DIR ?? join(tmpdir(), `orskh-e2e-outbox-${APP_PORT}`);
const SCREENS = process.env.E2E_SCREENS_DIR ?? join(tmpdir(), `orskh-e2e-screens-${APP_PORT}`);
const LOG_DIR = join(tmpdir(), `orskh-e2e-logs-${APP_PORT}`);
const APP = `http://localhost:${APP_PORT}`;
const LINE = `http://127.0.0.1:${LINE_PORT}`;

const SESSION_SECRET = randomBytes(32).toString("base64url");
const OTP_PEPPER = randomBytes(24).toString("base64url");
const LINE_ID = "1234567890";
const LINE_SECRET = randomBytes(16).toString("hex");
// the physician list (table physicians): DOC1 and DOC2 active, RETIRED deactivated; BREAK_GLASS only in ALLOWED_EMAILS
const DOC1 = "doctor.one@example.com";
const DOC1_NAME = "สมชาย ใจดี";
const DOC1_DEPT = "ศัลยกรรมทั่วไป";
const DOC1_FIXED = "สมชาย ใจงาม"; // the name after a correction in the table
const DOC2 = "second.doc@example.com";
const DOC2_NAME = "สมหญิง รักดี";
const RETIRED = "retired.doc@example.com";
const BREAK_GLASS = "break.glass@example.com";

const SUB_A = "U0000000000000000000000000000000a";
const SUB_B = "U0000000000000000000000000000000b";
const SUB_C = "U0000000000000000000000000000000c";
const SUB_D = "U0000000000000000000000000000000d";
const SUB_E = "U0000000000000000000000000000000e";
const SUB_F = "U0000000000000000000000000000000f";
const SUB_G = "U0000000000000000000000000000000g";
const SUB_H = "U0000000000000000000000000000000h";
// AUTH_ADMIN_LINE_IDS: admins are listed by LINE user id, the session's sub
const ADMIN_SUB = "U00000000000000000000000000000ad1";
const TG_TOKEN = "123456789:AAe2eTOKENe2eTOKENe2eTOKEN_test";
const TG_CHAT = "1228757000";
const XSS_NAME = `<img src=x onerror="window.__xss=1">หมอ A`;
const GENERIC = "ส่งรหัส 6 หลักไปที่อีเมลแล้ว";
// access requests (emails that are not on the physician list)
const UNLISTED = "intruder@example.com";
const NURSE = "new.nurse@example.com";
const WALK_IN = "walk.in@example.com";
const ADMIN_ID = Number(TG_CHAT); // a private chat's id is the user's id
const STRANGER_ID = 5550001;
const WEBHOOK_PATH = "/api/telegram/webhook";
const WIDTHS = [360, 1280];
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const children = [];
const issuedCodes = [];
const shots = [];

function baseEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("VERCEL") || k.startsWith("SMTP_")) delete env[k];
  return env;
}

function startProcess(name, args, env) {
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = join(LOG_DIR, `${name}.log`);
  const child = spawn(process.execPath, args, { cwd: repoRoot, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  child.stdout.on("data", (d) => chunks.push(d));
  child.stderr.on("data", (d) => chunks.push(d));
  const proc = { name, child, log: () => Buffer.concat(chunks).toString("utf8"), logFile, exit: null };
  child.on("exit", (code, signal) => (proc.exit = signal ?? `code ${code}`));
  children.push(proc);
  return proc;
}

/** Fails unless `port` can be bound on `host` (as the child will bind it), so the tests never talk to another server. */
function assertPortFree(port, host, envName) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", (e) =>
      reject(new Error(`port ${port} is not free (${e.code}); is another server running? Set ${envName} to a free port`)),
    );
    srv.listen({ port, host, exclusive: true }, () => srv.close(resolve));
  });
}

function stopAll() {
  for (const p of children) {
    try {
      writeFileSync(p.logFile, p.log());
      process.kill(-p.child.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

/** Waits until `url` answers; fails at once when `proc` (the server that should answer) has exited. */
async function waitFor(url, proc, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (proc?.exit) {
      writeFileSync(proc.logFile, proc.log());
      throw new Error(`${proc.name} exited (${proc.exit}) before it was ready; log: ${proc.logFile}`);
    }
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd: repoRoot, env, stdio: "inherit" });
    c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(" ")} exited ${code}`))));
  });
}

async function telegramMessages() {
  return (await fetch(`${LINE}/__control/telegram`)).json();
}

async function telegramCalls(method) {
  const calls = await (await fetch(`${LINE}/__control/telegram/calls`)).json();
  return method ? calls.filter((c) => c.method === method) : calls;
}

async function waitUntil(fn, what, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(100);
  }
}

/** Simulated Telegram webhook call (no Origin header, like Telegram). */
async function tgWebhook(path, update, secret) {
  const r = await fetch(`${APP}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret === undefined ? {} : { "x-telegram-bot-api-secret-token": secret }) },
    body: JSON.stringify(update),
    redirect: "manual",
  });
  return { status: r.status, body: await r.text() };
}

let updateId = 1000;
function tapUpdate(data, fromId, message) {
  updateId += 1;
  return {
    update_id: updateId,
    callback_query: {
      id: `cbq-${updateId}`,
      from: { id: fromId, is_bot: false, first_name: "Tester" },
      chat_instance: "e2e",
      data,
      ...(message ? { message: { message_id: message.message_id, chat: { id: Number(message.chat_id), type: "private" }, date: 0, text: "x" } } : {}),
    },
  };
}

async function waitForTelegram(count, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const msgs = await telegramMessages();
    if (msgs.length >= count || Date.now() > end) return msgs;
    await sleep(100);
  }
}

async function setIdentity(body) {
  const r = await fetch(`${LINE}/__control/identity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ picture: null, error: null, ...body }),
  });
  if (!r.ok) throw new Error("mock identity update failed");
}

function outboxFiles() {
  return existsSync(OUTBOX) ? readdirSync(OUTBOX).filter((f) => f.endsWith(".json")).sort() : [];
}

// Code emails by default; pass (m) => m.kind === "access_approved" for the approval email.
async function waitForMail(to, seen, timeoutMs = 10_000, match = (m) => typeof m.code === "string") {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const f of outboxFiles()) {
      if (seen.has(f)) continue;
      const m = JSON.parse(readFileSync(join(OUTBOX, f), "utf8"));
      if (m.to === to && match(m)) {
        seen.add(f);
        if (m.code) issuedCodes.push(m.code);
        return m;
      }
    }
    await sleep(150);
  }
  throw new Error(`no email to ${to} within ${timeoutMs} ms`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

/** A session cookie value signed like signSession() in src/lib/tokens.ts (for checks that need no sign-in). */
function sessionToken(email, secret = SESSION_SECRET, sub = "Ux") {
  return new SignJWT({ email, name: "x", picture: null })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuer("orskh")
    .setAudience("session")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
}

async function newContext(browser, width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, locale: "th-TH" });
  // LINE profile pictures are served locally: no network calls to LINE.
  await ctx.route("https://*.line-scdn.net/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1PX }),
  );
  return ctx;
}

function trackCsp(page, sink) {
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) sink.push(m.text());
  });
}

async function lineLogin(page, next) {
  await page.goto(next ? `${APP}/login?next=${encodeURIComponent(next)}` : `${APP}/login`);
  await page.click('[data-testid="line-login"]');
  await page.waitForLoadState("networkidle");
}

async function cookie(ctx, name) {
  return (await ctx.cookies(APP)).find((c) => c.name === name);
}

async function noSideScroll(page, label) {
  const w = await page.evaluate(() => {
    const scroller = document.querySelector("main") ?? document.documentElement;
    return [Math.max(document.documentElement.scrollWidth, scroller.scrollWidth), window.innerWidth];
  });
  assert(w[0] <= w[1], `${label}: horizontal scroll ${w[0]} > ${w[1]}`);
}

/** Every visible button, link and field is at least 44 px tall (touch targets). */
async function touchTargets(page, label) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("main a, main button, main input, main select")]
      .filter((el) => el.checkVisibility())
      .map((el) => [el.textContent?.trim() || el.id || el.tagName, Math.round(el.getBoundingClientRect().height)])
      .filter(([, h]) => h < 44),
  );
  assert(small.length === 0, `${label}: touch targets under 44 px: ${JSON.stringify(small)}`);
}

/** The page at 320 (overflow check), 360 and 1280 px; screenshots <name>-<width>.png. */
async function shoot(page, name, { full = true } = {}) {
  const size = page.viewportSize();
  for (const width of [320, ...WIDTHS]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 780 });
    await noSideScroll(page, `${name} at ${width}px`);
    if (width !== 320) {
      // The sign-in card scrolls inside <main> (the page itself never scrolls): grow the window to show all of it.
      const tall = full ? await page.evaluate(() => document.querySelector("main")?.scrollHeight ?? 0) : 0;
      const height = width === 1280 ? 900 : 780;
      if (tall > height) await page.setViewportSize({ width, height: tall });
      const file = `${name}-${width}.png`;
      await page.screenshot({ path: join(SCREENS, file) });
      shots.push(file);
      if (tall > height) await page.setViewportSize({ width, height });
    }
  }
  await page.setViewportSize(size);
}

function rawRequest(path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: APP_PORT, path, method: "GET", headers }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location });
    });
    req.on("error", reject);
    req.end();
  });
}

async function postJson(path, body, headers = {}) {
  const r = await fetch(`${APP}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  return { status: r.status, body: await r.text() };
}

/** The name the board's top bar shows (account menu text, present even while the menu is closed). */
async function boardName(page) {
  await page.waitForSelector('[data-testid="user-menu"]');
  return (await page.textContent('[data-testid="account-name"]'))?.trim();
}

/**
 * The built app creates every table on first use (here: the session check of an unlisted email), then the physician
 * list is loaded as in production: scripts/sync-physicians.mjs, from a roster CSV outside the repository.
 */
async function loadPhysicians(db) {
  const probe = await rawRequest("/", { host: `localhost:${APP_PORT}`, cookie: `session=${await sessionToken("schema.probe@example.com")}` });
  assert(probe.status === 307, `unlisted session -> ${probe.status}`);
  const tables = await db.query(
    "SELECT string_agg(table_name, ',' ORDER BY table_name) AS t FROM information_schema.tables WHERE table_schema = 'public'",
  );
  for (const t of ["access_requests", "line_bindings", "login_events", "otp_codes", "physicians"]) {
    assert(tables.rows[0].t?.split(",").includes(t), `the app created ${t}: ${tables.rows[0].t}`);
  }
  const dir = mkdtempSync(join(tmpdir(), "orskh-e2e-roster-"));
  try {
    const roster = join(dir, "roster.csv");
    writeFileSync(
      roster,
      [
        "email,name,dept",
        `${DOC1},${DOC1_NAME},${DOC1_DEPT}`,
        `Second.Doc@Example.com,${DOC2_NAME},`,
        `${RETIRED},สมศักดิ์ เกษียณ,จักษุ`,
      ].join("\n"),
    );
    await run(process.execPath, ["scripts/sync-physicians.mjs", "--apply", roster], { ...baseEnv(), DATABASE_URL: DB_URL });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // the removal step from README.md
  await db.query("UPDATE physicians SET active = false, updated_at = now() WHERE email = lower($1)", [RETIRED]);
  const listed = await db.query("SELECT email FROM physicians WHERE active ORDER BY email");
  assert(listed.rows.map((r) => r.email).join(",") === `${DOC1},${DOC2}`, `active physicians: ${JSON.stringify(listed.rows)}`);
}

async function main() {
  // Both ports must be free (checked before the build, and again before the servers start): a server
  // already listening there would answer in place of this build.
  const portsFree = async () => {
    await assertPortFree(APP_PORT, undefined, "E2E_APP_PORT");
    await assertPortFree(LINE_PORT, "127.0.0.1", "E2E_LINE_PORT");
  };
  await portsFree();
  rmSync(OUTBOX, { recursive: true, force: true });
  mkdirSync(OUTBOX, { recursive: true });
  mkdirSync(SCREENS, { recursive: true });

  // Fresh database: drop the sign-in tables so the app's lazy schema creation is exercised too (the physician list is
  // loaded once the app has created them, as in production: loadPhysicians() after the servers are up).
  const db = new pg.Pool({ connectionString: DB_URL, max: 2 });
  await db.query("DROP TABLE IF EXISTS otp_codes, line_bindings, login_events, physicians, access_requests");

  const appEnv = {
    ...baseEnv(),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    // Canonical-host redirect is active (VERCEL_ENV=production) but VERCEL itself is unset,
    // so dev transports and the mock LINE endpoints remain allowed.
    VERCEL_ENV: "production",
    APP_URL: APP,
    LINE_CHANNEL_ID: LINE_ID,
    LINE_CHANNEL_SECRET: LINE_SECRET,
    LINE_AUTH_URL: `${LINE}/oauth2/v2.1/authorize`,
    LINE_API_URL: LINE,
    SESSION_SECRET,
    OTP_PEPPER,
    // break-glass only: everyone else is in the physicians table
    ALLOWED_EMAILS: "Break.Glass@Example.com",
    DATABASE_URL: DB_URL,
    EMAIL_TRANSPORT: "file",
    EMAIL_OUTBOX_DIR: OUTBOX,
    TELEGRAM_BOT_TOKEN: TG_TOKEN,
    TELEGRAM_CHAT_ID: TG_CHAT,
    TELEGRAM_API_URL: LINE,
    // no holiday API calls from the tests
    BOT_API_TOKEN: "",
    // one admin (spaces and an empty entry are ignored); SUB_A, the first-login account, is not one
    AUTH_ADMIN_LINE_IDS: ` ${ADMIN_SUB} ,, `,
  };

  if (process.env.E2E_SKIP_BUILD !== "1") {
    console.log("[e2e] next build ...");
    await run(process.execPath, ["node_modules/next/dist/bin/next", "build"], { ...baseEnv(), NEXT_TELEMETRY_DISABLED: "1" });
  }

  await portsFree().catch(async (e) => {
    await db.end();
    throw e;
  });
  const line = startProcess("mock-line", ["tests/mock-line.mjs"], {
    ...baseEnv(),
    MOCK_LINE_PORT: String(LINE_PORT),
    MOCK_LINE_CLIENT_ID: LINE_ID,
    MOCK_LINE_CLIENT_SECRET: LINE_SECRET,
  });
  const app = startProcess("app", ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)], appEnv);
  try {
    await waitFor(`${LINE}/__control/health`, line);
    await waitFor(`${APP}/login`, app);
    // a late exit (for example EADDRINUSE after a race) would leave another server answering
    await sleep(500);
    for (const p of [line, app]) if (p.exit) throw new Error(`${p.name} exited (${p.exit}); log: ${p.logFile}`);
    await loadPhysicians(db);
  } catch (e) {
    await db.end();
    throw e;
  }
  console.log(`[e2e] app ${APP}, mock LINE ${LINE}, db ${DB_URL.replace(/:[^:@/]+@/, ":***@")}`);

  const browser = await chromium.launch();
  const seenMail = new Set();
  const results = [];
  let ctxA; // signed-in context reused by the logout test
  let genericMessage = "";
  let webhookSecret = ""; // read from the recorded setWebhook call
  let webhookPath = "";

  /** LINE login with a fresh account, then an email that is not on the physician list, verified by code. */
  async function verifyUnlisted(page, email) {
    await lineLogin(page);
    assert(new URL(page.url()).pathname === "/login/verify", `at ${page.url()}`);
    await page.fill("#email", email);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="otp-info"]');
    const mail = await waitForMail(email, seenMail);
    await page.fill("#code", mail.code);
    await page.waitForURL(`${APP}/login/request`);
    await page.waitForSelector('[data-testid="request-form"]');
  }

  async function fillRequest(page, first, last, position) {
    await page.fill("#firstName", first);
    await page.fill("#lastName", last);
    await page.selectOption("#position", position);
    await page.click('[data-testid="request-form"] button[type="submit"]');
  }

  async function requestRow(email) {
    return (await db.query("SELECT * FROM access_requests WHERE email = $1 ORDER BY id DESC LIMIT 1", [email])).rows[0];
  }

  async function t(name, fn) {
    const start = Date.now();
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  ✔ ${name} (${Date.now() - start} ms)`);
    } catch (e) {
      results.push({ name, ok: false });
      console.log(`  ✖ ${name}\n      ${e.stack?.split("\n").slice(0, 3).join("\n      ")}`);
    }
  }

  try {
    await t("unauthenticated / -> /login (documents, RSC and prefetch requests), with security headers", async () => {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const csp = [];
      trackCsp(page, csp);
      const resp = await page.goto(`${APP}/`);
      assert(new URL(page.url()).pathname === "/login", `landed on ${page.url()}`);
      const h = resp.headers();
      const policy = h["content-security-policy"] ?? "";
      const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
      assert(nonce && policy.includes("'strict-dynamic'"), "CSP nonce + strict-dynamic");
      for (const d of ["frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'", "connect-src 'self'", "form-action 'self' https://access.line.me"]) {
        assert(policy.includes(d), `CSP has ${d}`);
      }
      assert(h["x-content-type-options"] === "nosniff", "nosniff");
      assert(h["referrer-policy"] === "strict-origin-when-cross-origin", "referrer-policy");
      assert((h["x-robots-tag"] ?? "").includes("noindex"), "x-robots-tag");
      assert((h["strict-transport-security"] ?? "").includes("max-age="), "hsts");
      assert((h["permissions-policy"] ?? "").includes("camera=()"), "permissions-policy");
      assert(h["x-frame-options"] === "DENY", "x-frame-options");
      assert(!h["x-powered-by"], "no x-powered-by");
      const html = await resp.text();
      const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
      assert(scripts.length > 0 && scripts.every((s) => s.includes(`nonce="${nonce}"`)), "every script carries the nonce");
      await page.waitForLoadState("networkidle");
      assert(csp.length === 0, `CSP violations: ${csp.join(" | ")}`);
      const btn = page.locator('[data-testid="line-login"]');
      assert((await btn.getAttribute("href")) === "/api/auth/line/start", `LINE button href ${await btn.getAttribute("href")}`);
      await touchTargets(page, "/login");
      await shoot(page, "login");

      for (const headers of [{ RSC: "1" }, { RSC: "1", "Next-Router-Prefetch": "1" }, { Purpose: "prefetch" }]) {
        const r = await rawRequest("/", { host: `localhost:${APP_PORT}`, ...headers });
        assert(r.status === 307 && r.location?.startsWith("/login"), `gated ${JSON.stringify(headers)} -> ${r.status}`);
      }
      const rsc = await rawRequest("/?_rsc=abc", { host: `localhost:${APP_PORT}`, RSC: "1" });
      assert(rsc.status === 307, "?_rsc gated");
      const api = await fetch(`${APP}/api/board`, { redirect: "manual" });
      assert(api.status === 401, `non-auth API -> ${api.status}`);
      const robots = await (await fetch(`${APP}/robots.txt`)).text();
      assert(/Disallow: \/\s*$/.test(robots), "robots.txt disallows all");
      for (const file of ["/icon.svg", "/favicon.ico", "/apple-icon.png"]) {
        const r = await fetch(`${APP}${file}`, { redirect: "manual" });
        assert(r.status === 200, `${file} is served without a session: ${r.status}`);
      }
      const deep = await rawRequest("/?room=or-7", { host: `localhost:${APP_PORT}` });
      assert(deep.location === "/login?next=%2F%3Froom%3Dor-7", `next param: ${deep.location}`);
      const preview = await rawRequest("/preview", { host: `localhost:${APP_PORT}` });
      assert(preview.status === 404, `/preview is public but 404 outside development: ${preview.status}`);
      await ctx.close();
    });

    await t("canonical host: other hosts redirect to APP_URL with the same path", async () => {
      // Locally `next start` sees every request as APP_URL's host, so Next may relativize the
      // Location; resolve it against APP_URL (on Vercel it is absolute).
      const r = await rawRequest("/login?x=1", { host: "orskh-git-branch.vercel.app" });
      assert(r.status === 308 && new URL(r.location, APP).toString() === `${APP}/login?x=1`, `${r.status} ${r.location}`);
      const r2 = await rawRequest("//evil.test/path", { host: "orskh-abc123.vercel.app" });
      assert(r2.status === 308 && !r2.location.startsWith("//"), `protocol-relative Location: ${r2.location}`);
      assert(new URL(r2.location, APP).origin === APP, `no open redirect: ${r2.location}`);
      const same = await rawRequest("/login", { host: `localhost:${APP_PORT}` });
      assert(same.status === 200, `canonical host is served: ${same.status}`);
    });

    await t("first login: LINE -> email -> code -> board with the physician's full name from the table", async () => {
      await setIdentity({ sub: SUB_A, name: XSS_NAME, picture: "https://profile.line-scdn.net/0hMockPicture" });
      ctxA = await newContext(browser);
      const page = await ctxA.newPage();
      const csp = [];
      trackCsp(page, csp);
      await lineLogin(page);
      assert(new URL(page.url()).pathname === "/login/verify", `at ${page.url()}`);
      assert(!(await cookie(ctxA, "line-tx"))?.value, "tx cookie cleared");
      const pending = await cookie(ctxA, "pending");
      assert(pending?.httpOnly && pending.sameSite === "Lax", "pending cookie HttpOnly+Lax");
      const who = await page.textContent('[data-testid="line-name"]');
      assert(who.includes(XSS_NAME), `literal name shown: ${who}`);
      assert((await page.locator('img[src="x"]').count()) === 0, "no injected <img>");
      assert((await page.evaluate(() => window.__xss)) === undefined, "no script executed");
      await touchTargets(page, "/login/verify (email)");
      await shoot(page, "verify-email");

      await page.fill("#email", "  Doctor.One@EXAMPLE.com ");
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="otp-info"]');
      genericMessage = await page.textContent('[data-testid="otp-info"]');
      assert(genericMessage.includes(GENERIC), "generic message");
      assert((await page.textContent('[data-testid="resend"]')).includes("วินาที"), "resend countdown");
      await touchTargets(page, "/login/verify (code)");
      await shoot(page, "verify-code");

      const mail = await waitForMail(DOC1, seenMail);
      assert(/^\d{6}$/.test(mail.code) && mail.subject.includes(mail.code), "mail has code in subject");
      assert(mail.subject.includes("ORSKH.APP ตารางห้องผ่าตัด"), `subject names the board: ${mail.subject}`);
      // paste-friendly: spaces and Thai digits are accepted
      const thai = mail.code.replace(/\d/g, (d) => String.fromCharCode(0x0e50 + Number(d)));
      await page.fill("#code", `${thai.slice(0, 3)} ${thai.slice(3)}`);
      await page.waitForURL(`${APP}/`);
      assert((await boardName(page)) === DOC1_NAME, `full name from the table: ${await boardName(page)}`);
      const header = await page.textContent("header");
      assert(!header.includes("หมอ A"), "the LINE display name is not shown on the board");
      assert((await page.textContent('[data-testid="account-email"]')).trim() === DOC1, "email in the account menu");
      const emailStyle = await page.$eval('[data-testid="account-email"]', (el) => {
        const cs = getComputedStyle(el);
        return `${cs.whiteSpace} ${cs.textOverflow} ${cs.overflowWrap}`;
      });
      assert(emailStyle === "normal clip anywhere", `the whole email wraps, never an ellipsis: ${emailStyle}`);
      assert((await page.getAttribute('[data-testid="user-menu"] img', "src")) === "https://profile.line-scdn.net/0hMockPicture", "LINE picture");
      const s = await cookie(ctxA, "session");
      assert(s?.httpOnly && s.sameSite === "Lax" && s.path === "/", "session cookie flags");
      assert(!(await cookie(ctxA, "pending"))?.value, "pending cleared");
      await page.waitForLoadState("networkidle");
      assert(csp.length === 0, `CSP violations: ${csp.join(" | ")}`);
      const b = await db.query("SELECT email FROM line_bindings WHERE line_sub = $1", [SUB_A]);
      assert(b.rows[0]?.email === DOC1, "binding stored with normalized email");
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND event = 'login_otp'", [SUB_A]);
      assert(ev.rowCount === 1, "login_otp event logged");
      // Telegram alert, sent after the response
      const tg = await waitForTelegram(1);
      assert(tg.length === 1, `one Telegram alert: ${tg.length}`);
      assert(tg[0].token === TG_TOKEN && tg[0].chat_id === TG_CHAT && tg[0].parse_mode === "HTML", "alert to the configured chat");
      assert(tg[0].text.startsWith("🆕 <b>ผู้ใช้ใหม่ยืนยันตัวตนสำเร็จ</b>\nORSKH.APP ตารางห้องผ่าตัด\n"), `new-user header: ${tg[0].text}`);
      assert(tg[0].text.includes(`📧 อีเมล: ${DOC1}`), "alert names the email");
      assert(tg[0].text.includes(`\n🩺 แพทย์: ${DOC1_NAME} (${DOC1_DEPT})\n`), "name and department from the physicians table");
      assert(tg[0].text.includes("&lt;img") && !tg[0].text.includes("<img"), "LINE name escaped in the alert");
      assert(tg[0].text.includes("👥 ยืนยันแล้วทั้งหมด: 1 อีเมล"), "running total");
      // the code was single use
      const again = await page.request.post(`${APP}/api/auth/otp/verify`, {
        headers: { origin: APP, "content-type": "application/json" },
        data: { email: DOC1, code: mail.code },
      });
      assert(again.status() === 401, "pending cookie gone after login");
    });

    await t("board top bar and account menu at 360 and 1280 px; a corrected name shows without signing out", async () => {
      assert(ctxA, "signed-in context from the first-login test");
      const page = await ctxA.newPage();
      const csp = [];
      trackCsp(page, csp);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width === 1280 ? 900 : 780 });
        const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        assert(w[0] <= w[1], `no horizontal scroll at ${width}px: ${w[0]} > ${w[1]}`);
        const btn = await page.locator('[data-testid="user-menu"]').boundingBox();
        assert(btn && btn.height >= 44 && btn.width >= 44, `account button is a 44px target at ${width}px`);
        if (width === 1280) {
          assert(await page.locator('[data-testid="user-name"]').isVisible(), "name beside the avatar on a desktop");
          assert((await page.textContent('[data-testid="user-name"]')).trim() === DOC1_NAME, "desktop name");
        }
        await page.click('[data-testid="user-menu"]');
        const menu = page.locator('[data-testid="account-menu"]');
        await menu.waitFor({ state: "visible" });
        const box = await menu.boundingBox();
        assert(box.x >= 0 && box.x + box.width <= width, `menu inside the viewport at ${width}px`);
        const out = await page.locator('[data-testid="logout"]').boundingBox();
        assert(out.height >= 44, "sign-out button is 44px tall");
        const file = `board-menu-${width}.png`;
        await page.screenshot({ path: join(SCREENS, file) });
        shots.push(file);
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
      }
      // a corrected name in the table shows on the next request, with the same session
      await db.query("UPDATE physicians SET name = $2, updated_at = now() WHERE email = $1", [DOC1, DOC1_FIXED]);
      await page.reload();
      assert((await boardName(page)) === DOC1_FIXED, `corrected name: ${await boardName(page)}`);
      await db.query("UPDATE physicians SET name = $2, updated_at = now() WHERE email = $1", [DOC1, DOC1_NAME]);
      // a signed-in visit to /login must not follow a next= that leaves the site or normalizes to "//host"
      const session = await cookie(ctxA, "session");
      for (const next of ["/.//evil.test", "/..//evil.test", "/%2e//evil.test", "/a/..//evil.test", "//evil.test", "https://evil.test", "/\\evil.test"]) {
        const r = await fetch(`${APP}/login?next=${encodeURIComponent(next)}`, {
          redirect: "manual",
          headers: { cookie: `session=${session.value}` },
        });
        const loc = r.headers.get("location") ?? "";
        assert(r.status === 307 && new URL(loc, APP).origin === APP && !loc.startsWith("//"), `next=${next} -> ${r.status} ${loc}`);
      }
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      assert(csp.length === 0, `CSP violations: ${csp.join(" | ")}`);
      await page.close();
    });

    await t("second login with the same LINE account skips the code (binding) and keeps a safe next=", async () => {
      await setIdentity({ sub: SUB_A, name: "หมอ A" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const visited = [];
      page.on("framenavigated", (f) => f === page.mainFrame() && visited.push(new URL(f.url()).pathname));
      const before = outboxFiles().length;
      await lineLogin(page, "/?room=or-7");
      const at = new URL(page.url());
      assert(at.pathname === "/" && at.search === "?room=or-7", `next kept: ${page.url()}`);
      assert(!visited.includes("/login/verify"), "verify page not shown");
      assert(outboxFiles().length === before, "no email sent");
      assert((await boardName(page)) === DOC1_NAME, "full name again");
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND event = 'login_binding'", [SUB_A]);
      assert(ev.rowCount === 1, "login_binding event logged");
      assert((await telegramMessages()).length === 1, "no Telegram alert when the code step is skipped");
      await ctx.close();
    });

    await t("open redirect: next= pointing elsewhere is dropped by /api/auth/line/start", async () => {
      await setIdentity({ sub: SUB_A, name: "หมอ A" });
      for (const next of ["//evil.test/x", "https://evil.test/", "/\\evil.test", "/login/verify", "/api/auth/logout"]) {
        const ctx = await newContext(browser);
        const page = await ctx.newPage();
        await page.goto(`${APP}/api/auth/line/start?next=${encodeURIComponent(next)}`);
        await page.waitForLoadState("networkidle");
        const at = new URL(page.url());
        assert(at.origin === APP && at.pathname === "/" && at.search === "", `next=${next} -> ${page.url()}`);
        await ctx.close();
      }
    });

    await t("5 wrong codes lock the code (correct code is refused afterwards)", async () => {
      await setIdentity({ sub: SUB_B, name: "หมอ B" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      await lineLogin(page);
      await page.fill("#email", DOC2);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="otp-info"]');
      const mail = await waitForMail(DOC2, seenMail);
      const wrong = mail.code === "000000" ? "111111" : "000000";
      for (let i = 1; i <= 5; i++) {
        await page.fill("#code", wrong);
        const expected = i < 5 ? `เหลือโอกาสอีก ${5 - i} ครั้ง` : "ใส่รหัสผิดเกินจำนวนครั้งที่กำหนด";
        // the server keeps the count with its unit by U+00A0
        await page.waitForFunction(
          (txt) => document.querySelector('[data-testid="otp-error"]')?.textContent?.replace(/ /g, " ").includes(txt),
          expected,
          { timeout: 5000 },
        );
        await page.waitForFunction(() => !document.querySelector("#code")?.value);
      }
      assert(await page.isDisabled("#code"), "code input disabled once locked");
      assert((await telegramMessages()).length === 1, "no Telegram alert for a locked code");
      const r = await page.request.post(`${APP}/api/auth/otp/verify`, {
        headers: { origin: APP, "content-type": "application/json" },
        data: { email: DOC2, code: mail.code },
      });
      const body = await r.json();
      assert(r.status() === 400 && body.reason === "locked", `locked: ${JSON.stringify(body)}`);
      assert(!(await cookie(ctx, "session")), "no session");
      const a = await db.query("SELECT attempts FROM otp_codes WHERE line_sub = $1", [SUB_B]);
      assert(a.rows[0].attempts === 5, `attempts=${a.rows[0].attempts}`);
      // "เปลี่ยนอีเมล" by keyboard: the button goes away with the code step, so focus must land on the email field
      // (with the address selected for retyping), not drop to <body>.
      await page.getByRole("button", { name: "เปลี่ยนอีเมล" }).focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector("#email");
      const focused = await page.evaluate(() => document.activeElement?.id);
      assert(focused === "email", `focus after change-email: ${focused || "body"}`);
      // type="email" exposes no selectionStart, so check the selection by typing over it
      await page.keyboard.type("x");
      assert((await page.inputValue("#email")) === "x", `address selected for retyping: ${await page.inputValue("#email")}`);
      await ctx.close();
    });

    await t("unlisted email: same message, a real code is mailed, the code leads to /login/request (no session)", async () => {
      await setIdentity({ sub: SUB_C, name: "คนนอก" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const csp = [];
      trackCsp(page, csp);
      await lineLogin(page);
      await page.fill("#email", UNLISTED);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="otp-info"]');
      const msg = await page.textContent('[data-testid="otp-info"]');
      assert(msg === genericMessage, "identical message for listed and unlisted emails");
      const mail = await waitForMail(UNLISTED, seenMail);
      assert(/^\d{6}$/.test(mail.code), "a real code was mailed");
      // a wrong code gets exactly the same answer as for a listed email
      await page.fill("#code", mail.code === "000000" ? "111111" : "000000");
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="otp-error"]')?.textContent?.replace(/ /g, " ").includes("เหลือโอกาสอีก 4 ครั้ง"),
      );
      await page.fill("#code", mail.code);
      await page.waitForURL(`${APP}/login/request`);
      await page.waitForSelector('[data-testid="request-form"]');
      assert(!(await cookie(ctx, "session")), "no session");
      assert(!(await cookie(ctx, "pending"))?.value, "pending cleared");
      const access = await cookie(ctx, "access");
      assert(access?.httpOnly && access.sameSite === "Lax" && access.path === "/", "access cookie HttpOnly+Lax");
      assert(access.expires - Date.now() / 1000 > 11 * 3600 && access.expires - Date.now() / 1000 <= 12 * 3600 + 5, "access cookie ~12 h");
      assert((await page.textContent('[data-testid="request-email"]')).includes(UNLISTED), "verified email shown");
      assert((await page.textContent('[data-testid="line-name"]')) === "คนนอก", "LINE name shown");
      for (const [id, label] of [["firstName", "ชื่อ"], ["lastName", "นามสกุล"], ["position", "ตำแหน่ง"]]) {
        assert((await page.textContent(`label[for="${id}"]`)).trim() === label, `label for #${id}`);
      }
      const options = await page.$$eval("#position option", (os) => os.map((o) => [o.value, o.textContent]));
      assert(JSON.stringify(options) === JSON.stringify([["", "เลือกตำแหน่ง"], ["doctor", "แพทย์"], ["nurse", "พยาบาล"]]), `options ${JSON.stringify(options)}`);
      assert((await page.textContent('[data-testid="request-form"] button[type="submit"]')).trim() === "ส่งคำขอ", "submit button");
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND email = $2 AND event = 'otp_verified_unlisted'", [SUB_C, UNLISTED]);
      assert(ev.rowCount === 1, "otp_verified_unlisted event logged");
      assert((await telegramMessages()).length === 1, "no Telegram message before the form is sent");
      // verified the wrong address? a way back to the email step (LINE again, then another email)
      const other = page.locator('[data-testid="request-form"] [data-testid="other-email"]');
      assert((await other.textContent()).trim() === "ใช้อีเมลอื่น", "use another email link");
      await other.click();
      await page.waitForURL(`${APP}/login/verify`);
      await page.waitForSelector("#email");
      // still signed out everywhere else; /login offers the way back to the request
      await page.goto(`${APP}/`);
      assert(new URL(page.url()).pathname === "/login", "protected pages still redirect");
      assert((await page.locator('[data-testid="request-status-link"]').count()) === 1, "status link on /login");
      assert(csp.length === 0, `CSP violations: ${csp.join(" | ")}`);
      await ctx.close();
    });

    await t("deactivated physicians row: no session, the code leads to /login/request; reactivated: sign-in offered at once", async () => {
      const gated = await rawRequest("/", { host: `localhost:${APP_PORT}`, cookie: `session=${await sessionToken(RETIRED)}` });
      assert(gated.status === 307 && gated.location?.startsWith("/login"), `session of a deactivated email -> ${gated.status}`);
      await setIdentity({ sub: SUB_G, name: "หมอเกษียณ" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const before = (await telegramMessages()).length;
      await verifyUnlisted(page, RETIRED);
      assert(!(await cookie(ctx, "session")), "no session");
      const status = async () => (await page.request.get(`${APP}/api/auth/access/status`)).json();
      assert((await status()).status === "form", "nothing requested yet");
      // back on the list (the waiting page and the status check read the table, not the 60 s cache)
      await db.query("UPDATE physicians SET active = true, updated_at = now() WHERE email = lower($1)", [RETIRED]);
      assert((await status()).status === "signin", "status says sign in again");
      await page.reload();
      await page.waitForSelector('[data-testid="request-signin"]');
      assert((await page.textContent('[data-testid="request-signin"] a')).includes("เข้าสู่ระบบด้วย LINE"), "sign-in link");
      await db.query("UPDATE physicians SET active = false, updated_at = now() WHERE email = lower($1)", [RETIRED]);
      assert((await status()).status === "form", "removed again");
      assert((await telegramMessages()).length === before, "no Telegram message");
      await ctx.close();
    });

    await t("access request approved in Telegram: request with buttons, webhook checks, waiting page signs in with the requested name", async () => {
      await setIdentity({ sub: SUB_D, name: "พยาบาล <i>ใหม่</i>" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const csp = [];
      trackCsp(page, csp);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await verifyUnlisted(page, NURSE);
      await touchTargets(page, "/login/request (form)");
      await shoot(page, "request-form");

      // validation: field errors in Thai, marked on the field
      await fillRequest(page, "สมหญิง1", "ใจดี", "nurse");
      await page.waitForSelector('[data-testid="request-error"]');
      assert((await page.textContent('[data-testid="request-error"]')).includes("กรุณากรอกชื่อ"), "first name error");
      assert((await page.getAttribute("#firstName", "aria-invalid")) === "true", "first name marked invalid");
      await page.fill("#firstName", "");
      await page.selectOption("#position", "");
      await page.click('[data-testid="request-form"] button[type="submit"]');
      await page.waitForFunction(() => document.activeElement?.id === "firstName");
      assert((await requestRow(NURSE)) === undefined, "nothing stored for invalid input");

      await fillRequest(page, "  มาลี ", "ศรีสุข", "nurse");
      await page.waitForSelector('[data-testid="request-pending"]');
      const pendingText = await page.textContent('[data-testid="request-pending"]');
      assert(pendingText.includes("ส่งคำขอแล้ว รอผู้ดูแลอนุมัติ") && pendingText.includes(NURSE), "pending view names the email");
      assert(pendingText.includes("เข้าสู่ระบบให้อัตโนมัติ") && pendingText.includes("อีเมล"), "pending view explains what happens next");
      assert(pendingText.replace(/ /g, " ").includes("ยืนยันอีเมลด้วยรหัส 6 หลักอีกครั้ง"), "closing the page means another code later");
      assert(
        (await page.getAttribute('[data-testid="request-pending"] [data-testid="other-email"]', "href")) === "/api/auth/line/start",
        "use another email from the waiting page",
      );
      await shoot(page, "request-pending");

      // the request in the database and in Telegram (sent after the response)
      const row = await requestRow(NURSE);
      assert(row.status === "pending" && row.first_name === "มาลี" && row.last_name === "ศรีสุข" && row.position === "nurse", "row stored");
      assert(row.line_sub === SUB_D, "row bound to the LINE account");
      const msgs = await waitUntil(async () => {
        const m = (await telegramMessages()).filter((x) => x.text.startsWith("📝"));
        return m.length ? m : null;
      }, "Telegram request message");
      assert(msgs.length === 1, `one request message: ${msgs.length}`);
      const req = msgs[0];
      const lines = req.text.split("\n");
      assert(lines[0] === "📝 <b>คำขอเข้าใช้งาน (อีเมลไม่อยู่ในรายชื่อ)</b>" && lines[1] === "ORSKH.APP ตารางห้องผ่าตัด" && lines[2] === "", "header");
      assert(lines[3] === "👤 ชื่อ-นามสกุล: มาลี ศรีสุข", lines[3]);
      assert(lines[4] === "💼 ตำแหน่ง: พยาบาล", lines[4]);
      assert(lines[5] === `📧 อีเมล: ${NURSE} (ยืนยันรหัสแล้ว)`, lines[5]);
      assert(lines[6] === "💬 ชื่อ LINE: พยาบาล &lt;i&gt;ใหม่&lt;/i&gt;", `LINE name escaped: ${lines[6]}`);
      assert(/^🕒 เวลา: \d{1,2} \S+ 25\d\d \d{2}:\d{2} น\.$/.test(lines[7]) && lines.length === 8, lines[7]);
      assert(req.chat_id === TG_CHAT && req.parse_mode === "HTML" && req.token === TG_TOKEN, "sent to the admin chat as HTML");
      const kb = req.reply_markup?.inline_keyboard;
      assert(
        JSON.stringify(kb) === JSON.stringify([[{ text: "✅ อนุมัติ", callback_data: `ox:${row.id}:a` }, { text: "❌ ไม่อนุมัติ", callback_data: `ox:${row.id}:r` }]]),
        `buttons: ${JSON.stringify(kb)}`,
      );
      const stored = await waitUntil(async () => (await requestRow(NURSE)).tg_messages[0], "stored message id");
      assert(stored.chat_id === TG_CHAT && stored.message_id === req.message_id, `stored ${JSON.stringify(stored)}`);

      // webhook registered before the message, with a derived secret
      const set = await telegramCalls("setWebhook");
      assert(set.length === 1, `one setWebhook: ${set.length}`);
      const info = await telegramCalls("getWebhookInfo");
      assert(info.length >= 1, "getWebhookInfo called first");
      const hook = new URL(set[0].body.url);
      assert(hook.origin === APP && hook.pathname === WEBHOOK_PATH && /^\?v=[0-9a-f]{12}$/.test(hook.search), `webhook url ${hook}`);
      assert(JSON.stringify(set[0].body.allowed_updates) === '["callback_query"]', "only callback queries");
      webhookSecret = set[0].body.secret_token;
      webhookPath = `${hook.pathname}${hook.search}`;
      assert(/^[A-Za-z0-9_-]{43}$/.test(webhookSecret), "secret is URL-safe");

      // wrong / missing secret: refused, nothing changes
      const approve = tapUpdate(`ox:${row.id}:a`, ADMIN_ID, req);
      for (const secret of [undefined, "", "wrong-secret", `${webhookSecret}x`]) {
        const r = await tgWebhook(webhookPath, approve, secret);
        assert(r.status === 401 && !r.body.includes("ox:"), `secret ${secret} -> ${r.status} ${r.body}`);
      }
      await sleep(300);
      assert((await telegramCalls("setWebhook")).length === 1, "refused calls cause no new setWebhook (registered on this instance)");
      // someone who is not an administrator: polite refusal, nothing changes
      const stranger = await tgWebhook(webhookPath, tapUpdate(`ox:${row.id}:a`, STRANGER_ID, req), webhookSecret);
      assert(stranger.status === 200 && stranger.body === '{"ok":true}', `stranger -> ${stranger.status} ${stranger.body}`);
      await waitUntil(async () => (await telegramCalls("answerCallbackQuery")).length === 1, "refusal answer");
      assert((await telegramCalls("answerCallbackQuery"))[0].body.text === "คุณไม่มีสิทธิ์พิจารณาคำขอนี้", "refusal text");
      assert((await requestRow(NURSE)).status === "pending", "still pending");
      assert((await telegramCalls("editMessageText")).length === 0, "message not edited");

      // the administrator approves
      const ok = await tgWebhook(webhookPath, approve, webhookSecret);
      assert(ok.status === 200 && ok.body === '{"ok":true}', `approve -> ${ok.status} ${ok.body}`);
      const decided = await requestRow(NURSE);
      assert(decided.status === "approved" && String(decided.decided_by) === TG_CHAT && decided.decided_at, "approved by the admin");
      const edit = await waitUntil(async () => (await telegramCalls("editMessageText"))[0], "edited message");
      assert(edit.body.chat_id === TG_CHAT && edit.body.message_id === req.message_id, "the request message is edited");
      assert(edit.body.text.startsWith(`${req.text}\n\n✅ <b>อนุมัติแล้ว</b> · `) && edit.body.text.endsWith(" น."), `edited text: ${edit.body.text}`);
      assert(edit.body.reply_markup === undefined, "buttons removed");
      await waitUntil(async () => (await telegramCalls("answerCallbackQuery")).length === 2, "approval answer");
      const answer = (await telegramCalls("answerCallbackQuery"))[1].body.text;
      assert(answer === "อนุมัติแล้ว ระบบจะส่งอีเมลแจ้งผู้ขอ", `answered before the email is sent: ${answer}`);
      const mail = await waitForMail(NURSE, seenMail, 10_000, (m) => m.kind === "access_approved");
      assert(mail.subject === "อนุมัติการเข้าใช้งานแล้ว · ORSKH.APP ตารางห้องผ่าตัด" && mail.text.includes(`${APP}/login`), "approval email");
      assert(mail.text.includes("ระบบอาจขอให้ยืนยันอีเมลนี้ด้วยรหัส 6 หลักอีกครั้ง"), "approval email mentions the code");

      // the waiting page notices (polling) and signs in by itself; the board shows the requested name
      await page.waitForURL(`${APP}/`, { timeout: 25_000 });
      assert((await boardName(page)) === "มาลี ศรีสุข", `requested name on the board: ${await boardName(page)}`);
      assert((await cookie(ctx, "session"))?.httpOnly, "session cookie");
      assert(!(await cookie(ctx, "access"))?.value, "access cookie cleared");
      const b = await db.query("SELECT email FROM line_bindings WHERE line_sub = $1", [SUB_D]);
      assert(b.rows[0]?.email === NURSE, "LINE account bound to the approved email");
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND event = 'login_access'", [SUB_D]);
      assert(ev.rowCount === 1, "login_access event logged");

      // a second tap (any button): already decided, nothing changes
      const again = await tgWebhook(webhookPath, tapUpdate(`ox:${row.id}:r`, ADMIN_ID, req), webhookSecret);
      assert(again.status === 200, `second tap -> ${again.status}`);
      await waitUntil(async () => (await telegramCalls("answerCallbackQuery")).length === 3, "already-decided answer");
      assert((await telegramCalls("answerCallbackQuery"))[2].body.text === "คำขอนี้พิจารณาไปแล้ว (อนุมัติ)", "already decided text");
      assert((await requestRow(NURSE)).status === "approved", "still approved");
      assert((await telegramCalls("editMessageText")).length === 1, "no second edit");
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      assert(csp.length === 0, `CSP violations: ${csp.join(" | ")}`);
      await ctx.close();
    });

    await t("approved email: LINE fast path; another LINE account verifies by code and the alert shows the request", async () => {
      await setIdentity({ sub: SUB_D, name: "พยาบาล ใหม่" });
      let ctx = await newContext(browser);
      let page = await ctx.newPage();
      await lineLogin(page);
      assert(new URL(page.url()).pathname === "/", `binding fast path: ${page.url()}`);
      assert((await boardName(page)) === "มาลี ศรีสุข", "requested name again");
      await ctx.close();

      await setIdentity({ sub: SUB_F, name: "เครื่องใหม่" });
      ctx = await newContext(browser);
      page = await ctx.newPage();
      const before = (await telegramMessages()).length;
      await lineLogin(page);
      await page.fill("#email", NURSE);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="otp-info"]');
      const mail = await waitForMail(NURSE, seenMail);
      await page.fill("#code", mail.code);
      await page.waitForURL(`${APP}/`);
      await page.waitForSelector('[data-testid="user-menu"]');
      const alert = await waitUntil(async () => (await telegramMessages()).slice(before).find((m) => m.text.startsWith("🆕")), "verified alert");
      assert(alert.text.includes("\n🩺 พยาบาล: มาลี ศรีสุข (อนุมัติจากคำขอ)\n"), `alert: ${alert.text}`);
      assert(alert.text.includes(`📧 อีเมล: ${NURSE}`), "alert names the email");
      await ctx.close();
    });

    await t("access request rejected: waiting page shows it, no session, no new request for 24 h", async () => {
      await setIdentity({ sub: SUB_E, name: "ผู้มาใหม่" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      await verifyUnlisted(page, WALK_IN);
      await fillRequest(page, "Walk-In", "O'Neil", "doctor");
      await page.waitForSelector('[data-testid="request-pending"]');
      const row = await requestRow(WALK_IN);
      const req = await waitUntil(async () => (await telegramMessages()).find((m) => m.text.includes(WALK_IN)), "request message");
      assert(req.text.includes("💼 ตำแหน่ง: แพทย์") && req.text.includes("👤 ชื่อ-นามสกุล: Walk-In O'Neil"), "doctor request");
      // one polling loop, however often the tab is hidden and shown while a (slow) status check is in flight
      let statusCalls = 0;
      page.on("request", (q) => {
        if (new URL(q.url()).pathname === "/api/auth/access/status") statusCalls += 1;
      });
      await page.route("**/api/auth/access/status", async (route) => {
        await sleep(1500);
        await route.continue();
      });
      await page.evaluate(() => {
        let hidden = false;
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
        window.__setHidden = (h) => {
          hidden = h;
          document.dispatchEvent(new Event("visibilitychange"));
        };
      });
      const visible = async (v) => page.evaluate((h) => window.__setHidden(h), !v);
      await visible(false);
      await visible(true); // checks at once (in flight for 1.5 s)
      for (let i = 0; i < 3; i++) {
        await sleep(150);
        await visible(false);
        await visible(true);
      }
      await sleep(2500);
      assert(statusCalls === 1, `one status check for four hide/show switches during a slow check: ${statusCalls}`);
      await page.unroute("**/api/auth/access/status");

      const before = outboxFiles().length;
      const edits = (await telegramCalls("editMessageText")).length;
      const r = await tgWebhook(webhookPath, tapUpdate(`ox:${row.id}:r`, ADMIN_ID, req), webhookSecret);
      assert(r.status === 200, `reject -> ${r.status}`);
      await page.waitForSelector('[data-testid="request-rejected"]', { timeout: 25_000 });
      const text = await page.textContent('[data-testid="request-rejected"]');
      assert(text.includes("คำขอนี้ไม่ได้รับอนุมัติ") && text.includes("ติดต่อผู้ดูแลระบบ"), "rejected view");
      await shoot(page, "request-rejected");
      // the heading gets focus from script (no pointer interaction after a reload): no focus ring on it
      await page.reload();
      await page.waitForSelector('[data-testid="request-rejected"]');
      const ring = await page.evaluate(() => {
        const h = document.querySelector('[data-testid="request-rejected"] h2');
        h.focus();
        return { focused: document.activeElement === h, outline: getComputedStyle(h).outlineStyle };
      });
      assert(ring.focused && ring.outline === "none", `script-focused heading without a ring: ${JSON.stringify(ring)}`);
      const edit = await waitUntil(async () => (await telegramCalls("editMessageText"))[edits], "edited message");
      assert(edit.body.text.startsWith(`${req.text}\n\n❌ <b>ไม่อนุมัติ</b> · `), `edited: ${edit.body.text}`);
      assert((await requestRow(WALK_IN)).status === "rejected", "row rejected");
      assert(!(await cookie(ctx, "session")), "no session");
      await sleep(1000);
      assert(outboxFiles().length === before, "no email on rejection");
      const headers = { origin: APP, "content-type": "application/json" };
      const again = await page.request.post(`${APP}/api/auth/access/request`, { headers, data: { firstName: "Walk", lastName: "In", position: "doctor" } });
      assert(again.status() === 409 && (await again.json()).status === "rejected", `re-request -> ${again.status()}`);
      const complete = await page.request.post(`${APP}/api/auth/access/complete`, { headers, data: {} });
      assert(complete.status() === 403, `complete without approval -> ${complete.status()}`);
      const status = await page.request.get(`${APP}/api/auth/access/status`);
      assert((await status.json()).status === "rejected", "status endpoint");
      assert((await db.query("SELECT count(*)::int AS n FROM access_requests WHERE email = $1", [WALK_IN])).rows[0].n === 1, "one row");
      await ctx.close();
    });

    await t("break-glass ALLOWED_EMAILS: signs in without a table row and shows the LINE name", async () => {
      await setIdentity({ sub: SUB_H, name: "ผู้ดูแล ฉุกเฉิน" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      await lineLogin(page);
      await page.fill("#email", BREAK_GLASS);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="otp-info"]');
      const mail = await waitForMail(BREAK_GLASS, seenMail);
      await page.fill("#code", mail.code);
      await page.waitForURL(`${APP}/`);
      assert((await boardName(page)) === "ผู้ดูแล ฉุกเฉิน", `LINE name for an address without a row: ${await boardName(page)}`);
      assert((await db.query("SELECT 1 FROM physicians WHERE email = $1", [BREAK_GLASS])).rowCount === 0, "not in the table");
      await ctx.close();
    });

    await t("tampered state -> friendly error page, no session; cancelled login -> error page", async () => {
      await setIdentity({ sub: SUB_A, name: "หมอ A" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const start = await page.request.get(`${APP}/api/auth/line/start`, { maxRedirects: 0 });
      assert(start.status() === 302, "start redirects");
      const authorize = start.headers()["location"];
      const auth = new URL(authorize);
      for (const k of ["response_type", "client_id", "redirect_uri", "state", "scope", "nonce", "code_challenge", "code_challenge_method", "ui_locales"]) {
        assert(auth.searchParams.get(k), `authorize has ${k}`);
      }
      assert(auth.searchParams.get("code_challenge_method") === "S256" && auth.searchParams.get("ui_locales") === "th", "S256 + th");
      assert(auth.searchParams.get("redirect_uri") === `${APP}/api/auth/line/callback`, "callback URL");
      const back = await page.request.get(authorize, { maxRedirects: 0 });
      const callback = new URL(back.headers()["location"]);
      callback.searchParams.set("state", `x${callback.searchParams.get("state")}`);
      await page.goto(callback.toString());
      assert(page.url().includes("/login/error?code=state"), `at ${page.url()}`);
      const text = await page.textContent('[data-testid="login-error"]');
      assert(text.includes("หมดอายุหรือไม่ถูกต้อง") && !/error|stack|exception/i.test(text), "friendly Thai message");
      assert(!(await cookie(ctx, "session")), "no session");
      await touchTargets(page, "/login/error");
      await shoot(page, "login-error");

      await setIdentity({ sub: SUB_A, error: "access_denied" });
      await lineLogin(page);
      assert(page.url().includes("/login/error?code=cancelled"), `cancel -> ${page.url()}`);
      await setIdentity({ sub: SUB_A, name: "หมอ A" });
      await ctx.close();
    });

    await t("logout clears the session; protected pages redirect again", async () => {
      assert(ctxA, "signed-in context from the first-login test");
      const page = await ctxA.newPage();
      await page.goto(`${APP}/`);
      assert(new URL(page.url()).pathname === "/", "still signed in");
      await page.click('[data-testid="user-menu"]');
      await page.click('[data-testid="logout"]');
      await page.waitForURL(`${APP}/login`);
      assert(!(await cookie(ctxA, "session"))?.value, "session cookie cleared");
      await page.goto(`${APP}/`);
      assert(new URL(page.url()).pathname === "/login", "redirected after logout");
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND event = 'logout'", [SUB_A]);
      assert(ev.rowCount === 1, "logout event logged");
      await ctxA.close();
    });

    await t("CSRF: POST without/with foreign Origin is rejected; non-JSON rejected", async () => {
      for (const path of ["/api/auth/otp/send", "/api/auth/otp/verify", "/api/auth/logout", "/api/auth/access/request", "/api/auth/access/complete", "/"]) {
        const none = await postJson(path, { email: DOC1 });
        assert(none.status === 403, `${path} without Origin -> ${none.status}`);
        const evil = await postJson(path, { email: DOC1 }, { origin: "https://evil.test" });
        assert(evil.status === 403, `${path} foreign Origin -> ${evil.status}`);
      }
      const ref = await postJson("/api/auth/logout", {}, { referer: "https://evil.test/x" });
      assert(ref.status === 403, "foreign Referer rejected");
      const text = await fetch(`${APP}/api/auth/otp/send`, {
        method: "POST",
        headers: { origin: APP, "content-type": "text/plain" },
        body: JSON.stringify({ email: DOC1 }),
      });
      assert(text.status === 415, `text/plain -> ${text.status}`);
      const noPending = await postJson("/api/auth/otp/send", { email: DOC1 }, { origin: APP });
      assert(noPending.status === 401, `no pending cookie -> ${noPending.status}`);
      for (const path of ["/api/auth/access/request", "/api/auth/access/complete"]) {
        const noAccess = await postJson(path, {}, { origin: APP });
        assert(noAccess.status === 401, `${path} without access cookie -> ${noAccess.status}`);
      }
      // the Telegram webhook takes no Origin (server to server) but needs the secret header
      const hook = await postJson(WEBHOOK_PATH, { update_id: 1 });
      assert(hook.status === 401, `webhook without Origin and secret -> ${hook.status}`);
    });

    await t("forged or unlisted session tokens are rejected; the break-glass ALLOWED_EMAILS still works", async () => {
      for (const email of [DOC1, BREAK_GLASS]) {
        const ok = await rawRequest("/", { host: `localhost:${APP_PORT}`, cookie: `session=${await sessionToken(email)}` });
        assert(ok.status === 200, `valid token for ${email} -> ${ok.status}`);
      }
      for (const token of [await sessionToken("intruder@example.org"), await sessionToken(DOC1, "wrong-secret-wrong-secret-wrong-secret")]) {
        const r = await rawRequest("/", { host: `localhost:${APP_PORT}`, cookie: `session=${token}` });
        assert(r.status === 307 && r.location?.startsWith("/login"), `rejected -> ${r.status}`);
      }
    });

    await t("admin: the button and menu link only for a sub in AUTH_ADMIN_LINE_IDS; /admin is 404 for everyone else", async () => {
      const headers = (token) => ({ host: `localhost:${APP_PORT}`, cookie: `session=${token}` });
      const anon = await rawRequest("/admin", { host: `localhost:${APP_PORT}` });
      assert(anon.status === 307 && anon.location === "/login?next=%2Fadmin", `signed out: ${anon.status} ${anon.location}`);
      // signed in with an authorized email but a sub that is not an admin: same page as a mistyped address
      for (const token of [await sessionToken(DOC1), await sessionToken(DOC1, SESSION_SECRET, SUB_A)]) {
        const r = await rawRequest("/admin", headers(token));
        assert(r.status === 404, `non-admin /admin -> ${r.status}`);
        const html = await (await fetch(`${APP}/`, { headers: { cookie: `session=${token}` } })).text();
        assert(!html.includes('href="/admin"'), "no admin link on a non-admin's board");
      }
      // an admin sub with an email that is not authorized gets no session at all
      const unlisted = await rawRequest("/admin", headers(await sessionToken("intruder@example.org", SESSION_SECRET, ADMIN_SUB)));
      assert(unlisted.status === 307 && unlisted.location?.startsWith("/login"), `admin sub, unlisted email -> ${unlisted.status}`);

      const ctx = await newContext(browser);
      await ctx.addCookies([{ name: "session", value: await sessionToken(DOC2, SESSION_SECRET, ADMIN_SUB), url: APP, httpOnly: true, sameSite: "Lax" }]);
      const page = await ctx.newPage();
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      assert((await boardName(page)) === DOC2_NAME, `admin's name from the table: ${await boardName(page)}`);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width === 1280 ? 900 : 780 });
        await noSideScroll(page, `admin board at ${width}px`);
        const button = page.locator('[data-testid="admin-button"]');
        // below 390px the header button would cut the year off the date; the account menu's link stands in
        assert((await button.isVisible()) === (width >= 390), `admin button visible at ${width}px: ${await button.isVisible()}`);
        assert((await button.getAttribute("href")) === "/admin", "admin button opens /admin");
        await page.click('[data-testid="user-menu"]');
        const menu = page.locator('[data-testid="account-menu"]');
        await menu.waitFor({ state: "visible" });
        const link = page.locator('[data-testid="account-admin-link"]');
        assert((await link.isVisible()) && (await link.getAttribute("href")) === "/admin", "admin link in the account menu");
        assert(((await link.boundingBox())?.height ?? 0) >= 44, "admin link is a 44px target");
        const file = `board-admin-menu-${width}.png`;
        await page.screenshot({ path: join(SCREENS, file) });
        shots.push(file);
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
      }
      await ctx.close();
    });

    await t("/login/verify and /login/request without their cookie go back to /login", async () => {
      for (const path of ["/login/verify", "/login/request"]) {
        const r = await rawRequest(path, { host: `localhost:${APP_PORT}` });
        assert(r.status === 307 && r.location === "/login", `${path}: ${r.status} ${r.location}`);
      }
      const status = await fetch(`${APP}/api/auth/access/status`);
      assert(status.status === 401, `status without access cookie -> ${status.status}`);
    });

    await t("no OTP code appears in server logs", async () => {
      const log = app.log();
      for (const code of issuedCodes) assert(!log.includes(code), "code found in server log");
      assert(!log.includes(SESSION_SECRET) && !log.includes(OTP_PEPPER) && !log.includes(TG_TOKEN), "secret in log");
      assert(webhookSecret && !log.includes(webhookSecret), "webhook secret in log");
    });
  } finally {
    await browser.close();
    await db.end();
    stopAll();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`[e2e] screenshots: ${shots.length ? shots.join(", ") : "none"}`);
  console.log(`\n[e2e] ${results.length - failed} passed, ${failed} failed. Screenshots: ${SCREENS}  Logs: ${LOG_DIR}`);
  process.exitCode = failed ? 1 : 0;
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopAll();
    process.exit(130);
  });
}
// the servers run detached: stop them however this process ends (also on a crash, such as EPIPE on stdout)
process.on("exit", stopAll);

main().catch((e) => {
  console.error(`[e2e] ${e.message}`);
  stopAll();
  process.exitCode = 1;
});
