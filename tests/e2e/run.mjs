#!/usr/bin/env node
// End-to-end sign-in tests: mock LINE (+ mock Telegram) + mock deeSMSX + production build (next start) + Playwright
// (Chromium). The main app runs in provider mode (SMS_PROVIDER=deesmsx against tests/mock-deesmsx.mjs through
// DEESMSX_API_URL); a second app on the same build runs in local file mode (SMS_PROVIDER=file) near the end.
// Configurable so several copies can run in parallel:
//   E2E_APP_PORT (3100)  E2E_FILE_APP_PORT (3101)  E2E_LINE_PORT (4010)  E2E_SMS_PORT (4011)
//   E2E_DATABASE_URL (postgres://postgres:postgres@localhost:5432/orskh_e2e)
//   E2E_OUTBOX_DIR (tmp)  E2E_SCREENS_DIR (tmp)  E2E_SKIP_BUILD=1 (reuse .next)
// The database's sign-in tables are dropped first (the built app creates them again on first use), then the physician
// list (table physicians) is loaded with scripts/sync-physicians.mjs from a roster CSV in a new temp folder.
// Only invented phone numbers (0812345678, 09000000xx, 0611111111) and invented names are used. Keep E2E_SCREENS_DIR
// outside the repository.
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
const FILE_APP_PORT = Number(process.env.E2E_FILE_APP_PORT ?? 3101);
const LINE_PORT = Number(process.env.E2E_LINE_PORT ?? 4010);
const SMS_PORT = Number(process.env.E2E_SMS_PORT ?? 4011);
const DB_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/orskh_e2e";
const OUTBOX = process.env.E2E_OUTBOX_DIR ?? join(tmpdir(), `orskh-e2e-outbox-${APP_PORT}`);
const SCREENS = process.env.E2E_SCREENS_DIR ?? join(tmpdir(), `orskh-e2e-screens-${APP_PORT}`);
const LOG_DIR = join(tmpdir(), `orskh-e2e-logs-${APP_PORT}`);
const APP = `http://localhost:${APP_PORT}`;
const FILE_APP = `http://localhost:${FILE_APP_PORT}`;
const LINE = `http://127.0.0.1:${LINE_PORT}`;
const SMS = `http://127.0.0.1:${SMS_PORT}`;

const SESSION_SECRET = randomBytes(32).toString("base64url");
const OTP_PEPPER = randomBytes(24).toString("base64url");
const LINE_ID = "1234567890";
const LINE_SECRET = randomBytes(16).toString("hex");
const SMS_API_KEY = randomBytes(16).toString("hex");
const SMS_SECRET_KEY = randomBytes(24).toString("hex");
// the physician list (table physicians): DOC1 and DOC2 active, RETIRED deactivated; BREAK_GLASS only in ALLOWED_PHONES
const DOC1 = "0812345678";
const DOC1_NAME = "สมชาย ใจดี";
const DOC1_DEPT = "ศัลยกรรมทั่วไป";
const DOC1_FIXED = "สมชาย ใจงาม"; // the name after a correction in the table
const DOC2 = "0900000001";
const DOC2_NAME = "สมหญิง รักดี";
const RETIRED = "0900000002";
const BREAK_GLASS = "0611111111";

const SUB_A = "U0000000000000000000000000000000a";
const SUB_B = "U0000000000000000000000000000000b";
const SUB_C = "U0000000000000000000000000000000c";
const SUB_D = "U0000000000000000000000000000000d";
const SUB_E = "U0000000000000000000000000000000e";
const SUB_F = "U0000000000000000000000000000000f";
const SUB_G = "U0000000000000000000000000000000g";
const SUB_H = "U0000000000000000000000000000000h";
const SUB_I = "U0000000000000000000000000000000i";
const SUB_J = "U0000000000000000000000000000000j";
const SUB_K = "U0000000000000000000000000000000k";
const SUB_L = "U0000000000000000000000000000000l";
// AUTH_ADMIN_LINE_IDS: admins are listed by LINE user id, the session's sub
const ADMIN_SUB = "U00000000000000000000000000000ad1";
const TG_TOKEN = "123456789:AAe2eTOKENe2eTOKENe2eTOKEN_test";
const TG_CHAT = "1228757000";
const XSS_NAME = `<img src=x onerror="window.__xss=1">หมอ A`;
// the LINE name in every flow that takes screenshots: an ordinary Thai name (the XSS name is used where nothing is shot)
const LINE_NAME_A = "ต้นข้าว";
// access requests (numbers that are not on the physician list)
const UNLISTED = "0900000003";
const NURSE = "0900000004";
const WALK_IN = "0900000005";
const CAPPED = "0900000006";
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

/** 0812345678 -> 081-234-5678 (as the app shows it). */
const fmt = (p) => `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;
/** 0812345678 -> 66812345678 (as deeSMSX takes it). */
const intl = (p) => `66${p.slice(1)}`;

function baseEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(VERCEL|SMS_|DEESMSX_|ALLOWED_|TELEGRAM_|AUTH_ADMIN)/.test(k)) delete env[k];
  }
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

/** Every OTP the mock deeSMSX issued [{to, pin, ref, sender, token, at}]. */
async function smsIssued() {
  return (await fetch(`${SMS}/__control/sms`)).json();
}

async function smsControl(path, body) {
  const r = await fetch(`${SMS}/__control/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`mock deeSMSX ${path} failed`);
}

/** The next OTP the mock deeSMSX issued to `phone` that is not in `seen` (indexes into the issued list). */
async function waitForSms(phone, seen, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const all = await smsIssued();
    for (let i = 0; i < all.length; i++) {
      if (seen.has(i) || all[i].to !== intl(phone)) continue;
      seen.add(i);
      issuedCodes.push(all[i].pin, all[i].token);
      return all[i];
    }
    await sleep(150);
  }
  throw new Error(`no SMS to ${fmt(phone)} within ${timeoutMs} ms`);
}

/** The next local-mode SMS file {to, text, code, ref, at} for `phone` (SMS_PROVIDER=file). */
async function waitForSmsFile(phone, seen, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const f of outboxFiles()) {
      if (seen.has(f)) continue;
      const m = JSON.parse(readFileSync(join(OUTBOX, f), "utf8"));
      if (m.to === phone) {
        seen.add(f);
        issuedCodes.push(m.code);
        return m;
      }
    }
    await sleep(150);
  }
  throw new Error(`no SMS file for ${fmt(phone)} within ${timeoutMs} ms`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

/** A session cookie value signed like signSession() in src/lib/tokens.ts (for checks that need no sign-in). */
function sessionToken(phone, secret = SESSION_SECRET, sub = "Ux") {
  return new SignJWT({ phone, name: "x", picture: null })
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

async function lineLogin(page, next, base = APP) {
  await page.goto(next ? `${base}/login?next=${encodeURIComponent(next)}` : `${base}/login`);
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

/** `inner` lies within `outer` horizontally (nothing spills over a box's border). */
async function within(page, inner, outer, label) {
  const [a, b] = await Promise.all([page.locator(inner).boundingBox(), page.locator(outer).boundingBox()]);
  assert(a && b, `${label}: both elements visible`);
  assert(a.x >= b.x - 0.5 && a.x + a.width <= b.x + b.width + 0.5, `${label}: ${inner} [${a.x}, ${a.x + a.width}] outside ${outer} [${b.x}, ${b.x + b.width}]`);
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

/**
 * The page at 320 (overflow check), 360 and 1280 px; screenshots <name>-<width>.png (320 too with `narrow`).
 * `atEach(width)` runs extra checks at every width.
 */
async function shoot(page, name, { full = true, narrow = false, atEach = null } = {}) {
  const size = page.viewportSize();
  for (const width of [320, ...WIDTHS]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 780 });
    await noSideScroll(page, `${name} at ${width}px`);
    if (atEach) await atEach(width);
    if (width !== 320 || narrow) {
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
 * The built app creates every table on first use (here: the session check of an unlisted number), then the physician
 * list is loaded as in production: scripts/sync-physicians.mjs, from a roster CSV outside the repository.
 */
async function loadPhysicians(db) {
  const probe = await rawRequest("/", { host: `localhost:${APP_PORT}`, cookie: `session=${await sessionToken("0899999999")}` });
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
        "phone,name,dept",
        `${fmt(DOC1)},${DOC1_NAME},${DOC1_DEPT}`,
        `+66 ${DOC2.slice(1, 3)} ${DOC2.slice(3, 6)} ${DOC2.slice(6)},${DOC2_NAME},`,
        `${RETIRED},สมศักดิ์ เกษียณ,จักษุ`,
      ].join("\n"),
    );
    await run(process.execPath, ["scripts/sync-physicians.mjs", "--apply", roster], { ...baseEnv(), DATABASE_URL: DB_URL });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // the removal step from README.md
  await db.query("UPDATE physicians SET active = false, updated_at = now() WHERE phone = $1", [RETIRED]);
  const listed = await db.query("SELECT phone FROM physicians WHERE active ORDER BY phone");
  assert(listed.rows.map((r) => r.phone).join(",") === `${DOC1},${DOC2}`, `active physicians: ${JSON.stringify(listed.rows)}`);
}

async function main() {
  // Both ports must be free (checked before the build, and again before the servers start): a server
  // already listening there would answer in place of this build.
  const portsFree = async () => {
    await assertPortFree(APP_PORT, undefined, "E2E_APP_PORT");
    await assertPortFree(FILE_APP_PORT, undefined, "E2E_FILE_APP_PORT");
    await assertPortFree(LINE_PORT, "127.0.0.1", "E2E_LINE_PORT");
    await assertPortFree(SMS_PORT, "127.0.0.1", "E2E_SMS_PORT");
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
    // break-glass only: everyone else is in the physicians table (any common way of writing the number)
    ALLOWED_PHONES: ` ${fmt(BREAK_GLASS)} `,
    DATABASE_URL: DB_URL,
    // provider mode against the mock (DEESMSX_SENDER unset: the shared sender deeSMS.OTP)
    SMS_PROVIDER: "deesmsx",
    DEESMSX_API_KEY: SMS_API_KEY,
    DEESMSX_SECRET_KEY: SMS_SECRET_KEY,
    DEESMSX_API_URL: `${SMS}/v1`,
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
  const sms = startProcess("mock-deesmsx", ["tests/mock-deesmsx.mjs"], {
    ...baseEnv(),
    MOCK_SMS_PORT: String(SMS_PORT),
    MOCK_SMS_API_KEY: SMS_API_KEY,
    MOCK_SMS_SECRET_KEY: SMS_SECRET_KEY,
  });
  const app = startProcess("app", ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)], appEnv);
  let fileApp = null; // the local file mode app, started by its test
  try {
    await waitFor(`${LINE}/__control/health`, line);
    await waitFor(`${SMS}/__control/health`, sms);
    await waitFor(`${APP}/login`, app);
    // a late exit (for example EADDRINUSE after a race) would leave another server answering
    await sleep(500);
    for (const p of [line, sms, app]) if (p.exit) throw new Error(`${p.name} exited (${p.exit}); log: ${p.logFile}`);
    await loadPhysicians(db);
  } catch (e) {
    await db.end();
    throw e;
  }
  console.log(`[e2e] app ${APP}, mock LINE ${LINE}, mock deeSMSX ${SMS}, db ${DB_URL.replace(/:[^:@/]+@/, ":***@")}`);

  const browser = await chromium.launch();
  const seenSms = new Set();
  const seenFiles = new Set();
  const results = [];
  let ctxA; // signed-in context reused by the logout test
  let genericMessage = "";
  let webhookSecret = ""; // read from the recorded setWebhook call
  let webhookPath = "";

  /** On /login/verify: types the number (as `typed`), asks for the code, and returns the SMS the mock deeSMSX issued. */
  async function requestCode(page, phone, typed = phone) {
    await page.fill("#phone", typed);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="otp-info"]');
    return waitForSms(phone, seenSms);
  }

  /** LINE login with a fresh account, then a number that is not on the physician list, verified by code. */
  async function verifyUnlisted(page, phone) {
    await lineLogin(page);
    assert(new URL(page.url()).pathname === "/login/verify", `at ${page.url()}`);
    const sms = await requestCode(page, phone);
    await page.fill("#code", sms.pin);
    await page.waitForURL(`${APP}/login/request`);
    await page.waitForSelector('[data-testid="request-form"]');
  }

  async function fillRequest(page, first, last, position) {
    await page.fill("#firstName", first);
    await page.fill("#lastName", last);
    await page.selectOption("#position", position);
    await page.click('[data-testid="request-form"] button[type="submit"]');
  }

  async function requestRow(phone) {
    return (await db.query("SELECT * FROM access_requests WHERE phone = $1 ORDER BY id DESC LIMIT 1", [phone])).rows[0];
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

    await t("first login: LINE -> phone -> SMS code (deeSMSX) -> board with the physician's full name from the table", async () => {
      await setIdentity({ sub: SUB_A, name: LINE_NAME_A, picture: "https://profile.line-scdn.net/0hMockPicture" });
      ctxA = await newContext(browser);
      const page = await ctxA.newPage();
      const csp = [];
      trackCsp(page, csp);
      await lineLogin(page);
      assert(new URL(page.url()).pathname === "/login/verify", `at ${page.url()}`);
      assert(!(await cookie(ctxA, "line-tx"))?.value, "tx cookie cleared");
      const pending = await cookie(ctxA, "pending");
      assert(pending?.httpOnly && pending.sameSite === "Lax", "pending cookie HttpOnly+Lax");
      assert((await page.textContent("h1")).includes("ยืนยันเบอร์มือถือ"), `title: ${await page.textContent("h1")}`);
      assert((await page.textContent('[data-testid="line-name"]')).includes(LINE_NAME_A), "LINE name shown");
      // the number field: a phone keypad, the browser's saved number, a Thai example
      const attrs = await page.$eval("#phone", (el) => ({
        type: el.type,
        inputMode: el.inputMode,
        autocomplete: el.autocomplete,
        placeholder: el.placeholder,
      }));
      assert(
        JSON.stringify(attrs) === JSON.stringify({ type: "tel", inputMode: "numeric", autocomplete: "tel-national", placeholder: "08x-xxx-xxxx" }),
        `phone field: ${JSON.stringify(attrs)}`,
      );
      assert((await page.textContent('label[for="phone"]')).trim() === "เบอร์มือถือ", "phone label");
      assert(await page.isDisabled('button[type="submit"]'), "send button waits for a number");
      await touchTargets(page, "/login/verify (phone)");
      await shoot(page, "verify-phone");

      // pasted as on a business card ("+66 (0)", 19 characters): kept whole, normalized by the server, shown back formatted
      await page.focus("#phone");
      await page.keyboard.insertText("+66 (0) 81 234 5678");
      assert((await page.inputValue("#phone")) === "+66 (0) 81 234 5678", `pasted number kept whole: ${await page.inputValue("#phone")}`);
      assert((await page.textContent('button[type="submit"]')).trim() === "ส่งรหัสทาง SMS", "send button text");
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="otp-info"]');
      const sms = await waitForSms(DOC1, seenSms);
      assert(sms.sender === "deeSMS.OTP", `shared sender by default: ${sms.sender}`);
      assert(/^\d{6}$/.test(sms.pin), "a 6-digit pin");
      genericMessage = (await page.textContent('[data-testid="otp-info"]')).trim();
      assert(
        genericMessage === `ส่งรหัสทาง SMS ไปที่ ${fmt(DOC1)} แล้ว · รหัสอ้างอิง ${sms.ref}`,
        `code-step notice names the number and the SMS's reference: ${genericMessage}`,
      );
      assert((await page.textContent('[data-testid="otp-ref"]')) === sms.ref, "reference from deeSMSX");
      assert((await page.textContent('[data-testid="resend"]')).includes("วินาที"), "resend countdown");
      // the number, the reference and the 5-minute limit are read with the code field
      const describedBy = await page.getAttribute("#code", "aria-describedby");
      assert(describedBy === "otp-info code-help code-error", `code field description: ${describedBy}`);
      assert((await page.evaluate(() => document.activeElement?.id)) === "code", "focus on the code field");
      const codeAttrs = await page.$eval("#code", (el) => [el.autocomplete, el.inputMode, el.getAttribute("pattern")].join(" "));
      assert(codeAttrs === "one-time-code numeric [0-9]{6}", `code field: ${codeAttrs}`);
      assert((await page.getByRole("button", { name: "เปลี่ยนเบอร์" }).count()) === 1, "change-number button");
      await touchTargets(page, "/login/verify (code)");
      await shoot(page, "verify-code");

      // paste-friendly: spaces and Thai digits are accepted
      const thai = sms.pin.replace(/\d/g, (d) => String.fromCharCode(0x0e50 + Number(d)));
      await page.fill("#code", `${thai.slice(0, 3)} ${thai.slice(3)}`);
      await page.waitForURL(`${APP}/`);
      assert((await boardName(page)) === DOC1_NAME, `full name from the table: ${await boardName(page)}`);
      const header = await page.textContent("header");
      assert(!header.includes(LINE_NAME_A), "the LINE display name is not shown on the board");
      assert((await page.textContent('[data-testid="account-phone"]')).trim() === fmt(DOC1), "formatted number in the account menu");
      const phoneStyle = await page.$eval('[data-testid="account-phone"]', (el) => getComputedStyle(el).whiteSpace);
      assert(phoneStyle === "nowrap", `the number is never broken across lines: ${phoneStyle}`);
      assert((await page.getAttribute('[data-testid="user-menu"] img', "src")) === "https://profile.line-scdn.net/0hMockPicture", "LINE picture");
      const s = await cookie(ctxA, "session");
      assert(s?.httpOnly && s.sameSite === "Lax" && s.path === "/", "session cookie flags");
      assert(!(await cookie(ctxA, "pending"))?.value, "pending cleared");
      await page.waitForLoadState("networkidle");
      assert(csp.length === 0, `CSP violations: ${csp.join(" | ")}`);
      const b = await db.query("SELECT phone FROM line_bindings WHERE line_sub = $1", [SUB_A]);
      assert(b.rows[0]?.phone === DOC1, "binding stored with the canonical number");
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND phone = $2 AND event = 'login_otp'", [SUB_A, DOC1]);
      assert(ev.rowCount === 1, "login_otp event logged");
      const row = await db.query("SELECT code_hash, provider_token, ref, used_at FROM otp_codes WHERE line_sub = $1", [SUB_A]);
      assert(row.rows.length === 1 && row.rows[0].code_hash === null && row.rows[0].used_at, "provider mode stores no code hash; used");
      assert(row.rows[0].provider_token.startsWith("v1.") && !row.rows[0].provider_token.includes(sms.token), "provider token sealed at rest");
      assert(row.rows[0].ref === sms.ref, "reference stored");
      // Telegram alert, sent after the response
      const tg = await waitForTelegram(1);
      assert(tg.length === 1, `one Telegram alert: ${tg.length}`);
      assert(tg[0].token === TG_TOKEN && tg[0].chat_id === TG_CHAT && tg[0].parse_mode === "HTML", "alert to the configured chat");
      assert(tg[0].text.startsWith("🆕 <b>ผู้ใช้ใหม่ยืนยันตัวตนสำเร็จ</b>\nORSKH.APP ตารางห้องผ่าตัด\n"), `new-user header: ${tg[0].text}`);
      assert(tg[0].text.includes(`📱 เบอร์: ${fmt(DOC1)}`), "alert names the number");
      assert(tg[0].text.includes(`\n🩺 แพทย์: ${DOC1_NAME} (${DOC1_DEPT})\n`), "name and department from the physicians table");
      assert(tg[0].text.includes("👥 ยืนยันแล้วทั้งหมด: 1 เบอร์"), "running total");
      // the code was single use
      const again = await page.request.post(`${APP}/api/auth/otp/verify`, {
        headers: { origin: APP, "content-type": "application/json" },
        data: { phone: DOC1, code: sms.pin },
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
        const num = await page.locator('[data-testid="account-phone"]').boundingBox();
        assert(num && num.x >= box.x && num.x + num.width <= box.x + box.width + 0.5, `the number fits in the menu at ${width}px`);
        const out = await page.locator('[data-testid="logout"]').boundingBox();
        assert(out.height >= 44, "sign-out button is 44px tall");
        const file = `board-menu-${width}.png`;
        await page.screenshot({ path: join(SCREENS, file) });
        shots.push(file);
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
      }
      // a corrected name in the table shows on the next request, with the same session
      await db.query("UPDATE physicians SET name = $2, updated_at = now() WHERE phone = $1", [DOC1, DOC1_FIXED]);
      await page.reload();
      assert((await boardName(page)) === DOC1_FIXED, `corrected name: ${await boardName(page)}`);
      await db.query("UPDATE physicians SET name = $2, updated_at = now() WHERE phone = $1", [DOC1, DOC1_NAME]);
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
      await setIdentity({ sub: SUB_A, name: LINE_NAME_A });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const visited = [];
      page.on("framenavigated", (f) => f === page.mainFrame() && visited.push(new URL(f.url()).pathname));
      const before = (await smsIssued()).length;
      await lineLogin(page, "/?room=or-7");
      const at = new URL(page.url());
      assert(at.pathname === "/" && at.search === "?room=or-7", `next kept: ${page.url()}`);
      assert(!visited.includes("/login/verify"), "verify page not shown");
      assert((await smsIssued()).length === before, "no SMS sent");
      assert((await boardName(page)) === DOC1_NAME, "full name again");
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND event = 'login_binding'", [SUB_A]);
      assert(ev.rowCount === 1, "login_binding event logged");
      assert((await telegramMessages()).length === 1, "no Telegram alert when the code step is skipped");
      await ctx.close();
    });

    await t("open redirect: next= pointing elsewhere is dropped by /api/auth/line/start", async () => {
      await setIdentity({ sub: SUB_A, name: LINE_NAME_A });
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

    await t("5 wrong codes lock the code (correct code is refused afterwards); a hostile LINE name is shown as text", async () => {
      await setIdentity({ sub: SUB_B, name: XSS_NAME });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      await lineLogin(page);
      const who = await page.textContent('[data-testid="line-name"]');
      assert(who.includes(XSS_NAME), `literal name shown: ${who}`);
      assert((await page.locator('img[src="x"]').count()) === 0, "no injected <img>");
      assert((await page.evaluate(() => window.__xss)) === undefined, "no script executed");
      // a landline is refused before anything is sent
      await page.fill("#phone", "02-123-4567");
      await page.click('button[type="submit"]');
      await page.waitForSelector("#phone-error");
      assert((await page.textContent("#phone-error")).includes("เบอร์มือถือไม่ถูกต้อง"), "invalid number message");
      assert((await page.getAttribute("#phone", "aria-invalid")) === "true", "the number is marked invalid");
      await page.waitForFunction(() => document.activeElement?.id === "phone", null, { timeout: 2000 });
      await page.keyboard.press("End");
      await page.keyboard.type("8");
      assert((await page.getAttribute("#phone", "aria-invalid")) === null, "editing the number clears the invalid mark");
      const sms = await requestCode(page, DOC2);
      const wrong = sms.pin === "000000" ? "111111" : "000000";
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
      // the disabled field cannot hold focus: it goes to the error while the resend countdown runs (not to <body>)
      await page.waitForFunction(() => ["code-error", "resend"].includes(document.activeElement?.id || document.activeElement?.dataset?.testid), null, { timeout: 2000 });
      assert((await telegramMessages()).length === 1, "no Telegram alert for a locked code");
      const r = await page.request.post(`${APP}/api/auth/otp/verify`, {
        headers: { origin: APP, "content-type": "application/json" },
        data: { phone: DOC2, code: sms.pin },
      });
      const body = await r.json();
      assert(r.status() === 400 && body.reason === "locked", `locked: ${JSON.stringify(body)}`);
      assert(!(await cookie(ctx, "session")), "no session");
      const a = await db.query("SELECT attempts FROM otp_codes WHERE line_sub = $1", [SUB_B]);
      assert(a.rows[0].attempts === 5, `attempts=${a.rows[0].attempts}`);
      // "เปลี่ยนเบอร์" by keyboard: the button goes away with the code step, so focus must land on the number field
      // (with the number selected for retyping), not drop to <body>.
      await page.getByRole("button", { name: "เปลี่ยนเบอร์" }).focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector("#phone");
      const focused = await page.evaluate(() => document.activeElement?.id);
      assert(focused === "phone", `focus after change-number: ${focused || "body"}`);
      await page.keyboard.type("9");
      assert((await page.inputValue("#phone")) === "9", `number selected for retyping: ${await page.inputValue("#phone")}`);
      await ctx.close();
    });

    await t("unlisted number: same answer, a real SMS code, the code leads to /login/request (no session)", async () => {
      await setIdentity({ sub: SUB_C, name: "คนนอก" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const csp = [];
      trackCsp(page, csp);
      await lineLogin(page);
      const sms = await requestCode(page, UNLISTED);
      const msg = (await page.textContent('[data-testid="otp-info"]')).trim();
      const shape = (m) => m.replace(/\d{3}-\d{3}-\d{4}/, "N").replace(/รหัสอ้างอิง \S+$/, "R");
      assert(shape(msg) === shape(genericMessage), `the same answer for listed and unlisted numbers: ${msg}`);
      assert(msg.includes(fmt(UNLISTED)) && msg.endsWith(sms.ref), "names this number and its reference");
      assert(/^\d{6}$/.test(sms.pin), "a real code was sent");
      // a wrong code gets exactly the same answer as for a listed number
      await page.fill("#code", sms.pin === "000000" ? "111111" : "000000");
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="otp-error"]')?.textContent?.replace(/ /g, " ").includes("เหลือโอกาสอีก 4 ครั้ง"),
      );
      await page.fill("#code", sms.pin);
      await page.waitForURL(`${APP}/login/request`);
      await page.waitForSelector('[data-testid="request-form"]');
      assert(!(await cookie(ctx, "session")), "no session");
      assert(!(await cookie(ctx, "pending"))?.value, "pending cleared");
      const access = await cookie(ctx, "access");
      assert(access?.httpOnly && access.sameSite === "Lax" && access.path === "/", "access cookie HttpOnly+Lax");
      assert(access.expires - Date.now() / 1000 > 11 * 3600 && access.expires - Date.now() / 1000 <= 12 * 3600 + 5, "access cookie ~12 h");
      assert((await page.textContent('[data-testid="request-phone"]')).trim() === fmt(UNLISTED), "verified number shown");
      assert((await page.textContent('[data-testid="line-name"]')) === "คนนอก", "LINE name shown");
      for (const [id, label] of [["firstName", "ชื่อ"], ["lastName", "นามสกุล"], ["position", "ตำแหน่ง"]]) {
        assert((await page.textContent(`label[for="${id}"]`)).trim() === label, `label for #${id}`);
      }
      const options = await page.$$eval("#position option", (os) => os.map((o) => [o.value, o.textContent]));
      assert(JSON.stringify(options) === JSON.stringify([["", "เลือกตำแหน่ง"], ["doctor", "แพทย์"], ["nurse", "พยาบาล"]]), `options ${JSON.stringify(options)}`);
      assert((await page.textContent('[data-testid="request-form"] button[type="submit"]')).trim() === "ส่งคำขอ", "submit button");
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND phone = $2 AND event = 'otp_verified_unlisted'", [SUB_C, UNLISTED]);
      assert(ev.rowCount === 1, "otp_verified_unlisted event logged");
      assert((await telegramMessages()).length === 1, "no Telegram message before the form is sent");
      // verified the wrong number? a way back to the number step (LINE again, then another number)
      const other = page.locator('[data-testid="request-form"] [data-testid="other-phone"]');
      assert((await other.textContent()).trim() === "ใช้เบอร์อื่น", "use another number link");
      await other.click();
      await page.waitForURL(`${APP}/login/verify`);
      await page.waitForSelector("#phone");
      // still signed out everywhere else; /login offers the way back to the request
      await page.goto(`${APP}/`);
      assert(new URL(page.url()).pathname === "/login", "protected pages still redirect");
      assert((await page.locator('[data-testid="request-status-link"]').count()) === 1, "status link on /login");
      assert((await page.textContent("main")).includes("SMS"), "/login mentions the SMS code");
      assert(csp.length === 0, `CSP violations: ${csp.join(" | ")}`);
      await ctx.close();
    });

    await t("deactivated physicians row: no session, the code leads to /login/request; reactivated: sign-in offered at once", async () => {
      const gated = await rawRequest("/", { host: `localhost:${APP_PORT}`, cookie: `session=${await sessionToken(RETIRED)}` });
      assert(gated.status === 307 && gated.location?.startsWith("/login"), `session of a deactivated number -> ${gated.status}`);
      await setIdentity({ sub: SUB_G, name: "หมอเกษียณ" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const before = (await telegramMessages()).length;
      await verifyUnlisted(page, RETIRED);
      assert(!(await cookie(ctx, "session")), "no session");
      const status = async () => (await page.request.get(`${APP}/api/auth/access/status`)).json();
      assert((await status()).status === "form", "nothing requested yet");
      // back on the list (the waiting page and the status check read the table, not the 60 s cache)
      await db.query("UPDATE physicians SET active = true, updated_at = now() WHERE phone = $1", [RETIRED]);
      assert((await status()).status === "signin", "status says sign in again");
      await page.reload();
      await page.waitForSelector('[data-testid="request-signin"]');
      assert((await page.textContent('[data-testid="request-signin"] a')).includes("เข้าสู่ระบบด้วย LINE"), "sign-in link");
      await db.query("UPDATE physicians SET active = false, updated_at = now() WHERE phone = $1", [RETIRED]);
      assert((await status()).status === "form", "removed again");
      assert((await telegramMessages()).length === before, "no Telegram message");
      await ctx.close();
    });

    await t("access request approved in Telegram: request with buttons, webhook checks, waiting page signs in with the requested name", async () => {
      await setIdentity({ sub: SUB_D, name: "มาลี" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const csp = [];
      trackCsp(page, csp);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await verifyUnlisted(page, NURSE);
      await touchTargets(page, "/login/request (form)");
      await shoot(page, "request-form", {
        narrow: true,
        atEach: (width) => within(page, '[data-testid="request-phone"]', '[data-testid="request-identity"]', `request header at ${width}px`),
      });

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
      const pendingText = (await page.textContent('[data-testid="request-pending"]')).replace(/ /g, " ");
      assert(pendingText.includes("ส่งคำขอแล้ว รอผู้ดูแลอนุมัติ") && pendingText.includes(fmt(NURSE)), "pending view names the number");
      assert(pendingText.includes("เข้าสู่ระบบให้อัตโนมัติ"), "pending view explains what happens next");
      assert(
        pendingText.includes("“ดูสถานะคำขอเข้าใช้งาน”") && pendingText.includes("12 ชั่วโมง"),
        "closing the page: the result is on the login page's status button for 12 h (no new SMS code)",
      );
      assert(
        (await page.getAttribute('[data-testid="request-pending"] [data-testid="other-phone"]', "href")) === "/api/auth/line/start",
        "use another number from the waiting page",
      );
      await shoot(page, "request-pending", {
        atEach: (width) => within(page, '[data-testid="request-phone"]', '[data-testid="request-identity"]', `request header at ${width}px`),
      });

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
      assert(lines[0] === "📝 <b>คำขอเข้าใช้งาน (เบอร์ไม่อยู่ในรายชื่อ)</b>" && lines[1] === "ORSKH.APP ตารางห้องผ่าตัด" && lines[2] === "", "header");
      assert(lines[3] === "👤 ชื่อ-นามสกุล: มาลี ศรีสุข", lines[3]);
      assert(lines[4] === "💼 ตำแหน่ง: พยาบาล", lines[4]);
      assert(lines[5] === `📱 เบอร์: ${fmt(NURSE)} (ยืนยันรหัสแล้ว)`, lines[5]);
      assert(lines[6] === "💬 ชื่อ LINE: มาลี", lines[6]);
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
      const smsBefore = (await smsIssued()).length;
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
      assert(answer === "อนุมัติแล้ว หน้ารออนุมัติของผู้ขอจะเข้าสู่ระบบให้เอง", `approval answer: ${answer}`);

      // the waiting page notices (polling) and signs in by itself; the board shows the requested name
      await page.waitForURL(`${APP}/`, { timeout: 25_000 });
      assert((await boardName(page)) === "มาลี ศรีสุข", `requested name on the board: ${await boardName(page)}`);
      assert((await page.textContent('[data-testid="account-phone"]')).trim() === fmt(NURSE), "the approved number in the menu");
      assert((await cookie(ctx, "session"))?.httpOnly, "session cookie");
      assert(!(await cookie(ctx, "access"))?.value, "access cookie cleared");
      const b = await db.query("SELECT phone FROM line_bindings WHERE line_sub = $1", [SUB_D]);
      assert(b.rows[0]?.phone === NURSE, "LINE account bound to the approved number");
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND event = 'login_access'", [SUB_D]);
      assert(ev.rowCount === 1, "login_access event logged");
      assert((await smsIssued()).length === smsBefore, "no SMS is sent on approval (it would cost credit)");

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

    await t("approved number: LINE fast path; another LINE account verifies by code and the alert shows the request", async () => {
      await setIdentity({ sub: SUB_D, name: "มาลี" });
      let ctx = await newContext(browser);
      let page = await ctx.newPage();
      await lineLogin(page);
      assert(new URL(page.url()).pathname === "/", `binding fast path: ${page.url()}`);
      assert((await boardName(page)) === "มาลี ศรีสุข", "requested name again");
      await ctx.close();

      await setIdentity({ sub: SUB_F, name: "<b>เครื่องใหม่</b>" });
      ctx = await newContext(browser);
      page = await ctx.newPage();
      const before = (await telegramMessages()).length;
      await lineLogin(page);
      const sms = await requestCode(page, NURSE);
      await page.fill("#code", sms.pin);
      await page.waitForURL(`${APP}/`);
      await page.waitForSelector('[data-testid="user-menu"]');
      const alert = await waitUntil(async () => (await telegramMessages()).slice(before).find((m) => m.text.startsWith("⚠️") || m.text.startsWith("🆕")), "verified alert");
      assert(alert.text.includes("\n🩺 พยาบาล: มาลี ศรีสุข (อนุมัติจากคำขอ)\n"), `alert: ${alert.text}`);
      assert(alert.text.includes(`📱 เบอร์: ${fmt(NURSE)}`), "alert names the number");
      assert(alert.text.includes("&lt;b&gt;เครื่องใหม่&lt;/b&gt;") && !alert.text.includes("<b>เครื่องใหม่"), "LINE name escaped in the alert");
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
      const req = await waitUntil(async () => (await telegramMessages()).find((m) => m.text.includes(fmt(WALK_IN))), "request message");
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

      const smsBefore = (await smsIssued()).length;
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
      assert((await smsIssued()).length === smsBefore, "no SMS on rejection");
      const headers = { origin: APP, "content-type": "application/json" };
      const again = await page.request.post(`${APP}/api/auth/access/request`, { headers, data: { firstName: "Walk", lastName: "In", position: "doctor" } });
      assert(again.status() === 409 && (await again.json()).status === "rejected", `re-request -> ${again.status()}`);
      const complete = await page.request.post(`${APP}/api/auth/access/complete`, { headers, data: {} });
      assert(complete.status() === 403, `complete without approval -> ${complete.status()}`);
      const status = await page.request.get(`${APP}/api/auth/access/status`);
      assert((await status.json()).status === "rejected", "status endpoint");
      assert((await db.query("SELECT count(*)::int AS n FROM access_requests WHERE phone = $1", [WALK_IN])).rows[0].n === 1, "one row");
      await ctx.close();
    });

    await t("break-glass ALLOWED_PHONES: signs in without a table row and shows the LINE name (as text)", async () => {
      await setIdentity({ sub: SUB_H, name: "ผู้ดูแล <b>ฉุกเฉิน</b>" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      await lineLogin(page);
      // written the international way: the same number
      const sms = await requestCode(page, BREAK_GLASS, `+66 ${BREAK_GLASS.slice(1, 3)} ${BREAK_GLASS.slice(3, 6)} ${BREAK_GLASS.slice(6)}`);
      await page.fill("#code", sms.pin);
      await page.waitForURL(`${APP}/`);
      assert((await boardName(page)) === "ผู้ดูแล <b>ฉุกเฉิน</b>", `LINE name for a number without a row: ${await boardName(page)}`);
      assert((await page.innerHTML('[data-testid="account-name"]')).includes("&lt;b&gt;"), "the LINE name is text, not markup");
      assert((await page.textContent('[data-testid="account-phone"]')).trim() === fmt(BREAK_GLASS), "formatted number");
      assert((await db.query("SELECT 1 FROM physicians WHERE phone = $1", [BREAK_GLASS])).rowCount === 0, "not in the table");
      await ctx.close();
    });

    await t("deeSMSX failures: no quota used, a clear Thai message, Telegram alerts; an outage at verify keeps the code", async () => {
      await setIdentity({ sub: SUB_I, name: "หมอสอง" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const tgBefore = (await telegramMessages()).length;
      await lineLogin(page);
      const sendAndExpect = async (mode, message) => {
        await smsControl("fail", { mode });
        await page.fill("#phone", DOC2);
        await page.click('button[type="submit"]');
        await page.waitForFunction(
          (m) => document.querySelector("#phone-error")?.textContent?.replace(/ /g, " ").includes(m),
          message.replace(/ /g, " "),
          { timeout: 15_000 },
        );
        assert(await page.isVisible("#phone"), `still on the number step after ${mode}`);
      };
      const invalidMark = () => page.getAttribute("#phone", "aria-invalid");
      await sendAndExpect("102", "ขณะนี้ระบบส่ง SMS ไม่ได้ กรุณาลองใหม่ภายหลัง หรือติดต่อผู้ดูแล");
      assert((await invalidMark()) === null, "no credit: the number is not marked invalid");
      await sendAndExpect("9", "ระบบยังไม่พร้อม กรุณาติดต่อผู้ดูแล");
      assert((await invalidMark()) === null, "settings: the number is not marked invalid");
      await sendAndExpect("99", "ส่ง SMS ไปที่เบอร์นี้ไม่ได้ กรุณาตรวจสอบเบอร์มือถือ");
      assert((await invalidMark()) === "true", "deeSMSX refused the number: marked invalid");
      const rows = await db.query("SELECT count(*)::int AS n FROM otp_codes WHERE line_sub = $1", [SUB_I]);
      assert(rows.rows[0].n === 0, `refused sends leave no row (no quota, no cooldown): ${rows.rows[0].n}`);
      const failedEv = await db.query("SELECT count(*)::int AS n FROM login_events WHERE line_sub = $1 AND event = 'otp_send_failed'", [SUB_I]);
      assert(failedEv.rows[0].n === 3, `otp_send_failed logged: ${failedEv.rows[0].n}`);
      // A gateway's HTML page: deeSMSX may have sent the SMS. The send counts (the row stays, unusable), the user
      // waits out the cooldown on the number step.
      await sendAndExpect("html", "ส่งรหัสไม่สำเร็จ หากได้รับ SMS ภายหลัง รหัสนั้นใช้ไม่ได้");
      assert((await invalidMark()) === null, "maybe sent: the number is not marked invalid");
      const kept = await db.query("SELECT code_hash, provider_token, expires_at <= created_at AS dead FROM otp_codes WHERE line_sub = $1", [SUB_I]);
      assert(kept.rows.length === 1 && kept.rows[0].dead && !kept.rows[0].code_hash && !kept.rows[0].provider_token, `maybe-sent row kept, unusable: ${JSON.stringify(kept.rows)}`);
      const uncertainEv = await db.query("SELECT count(*)::int AS n FROM login_events WHERE line_sub = $1 AND event = 'otp_send_uncertain'", [SUB_I]);
      assert(uncertainEv.rows[0].n === 1, `otp_send_uncertain logged: ${uncertainEv.rows[0].n}`);
      assert(await page.isDisabled('button[type="submit"]'), "the send button waits out the cooldown");
      assert((await page.textContent('button[type="submit"]')).includes("ส่งรหัสได้ใน"), `countdown on the button: ${await page.textContent('button[type="submit"]')}`);
      // Another number is not held back by that countdown.
      await page.fill("#phone", "0900000009");
      assert(!(await page.isDisabled('button[type="submit"]')), "another number may be tried");
      // Reloaded (no countdown in the page): the server's cooldown refuses it, and as no usable code exists for this
      // number the page stays on the number step instead of asking for a code that was never sent.
      const issuedBefore = (await smsIssued()).length;
      await page.reload();
      await page.fill("#phone", DOC2);
      await page.click('button[type="submit"]');
      await page.waitForSelector("#phone-error");
      assert((await page.textContent("#phone-error")).includes("ขอรหัสบ่อยเกินไป"), "cooldown message");
      assert(await page.isVisible("#phone"), "still on the number step: no code is pending");
      assert((await smsIssued()).length === issuedBefore, "deeSMSX is not asked during the cooldown");
      await db.query("DELETE FROM otp_codes WHERE line_sub = $1", [SUB_I]); // as if the minute had passed
      await page.reload();
      const alerts = await waitUntil(async () => {
        const m = (await telegramMessages()).slice(tgBefore).map((x) => x.text);
        return m.length >= 2 ? m : null;
      }, "SMS problem alerts");
      assert(alerts.some((x) => x.startsWith("💳 <b>เครดิต SMS หมด ส่งรหัสไม่ได้</b>") && x.includes("(รหัส 102)")), `no-credit alert: ${alerts.join(" | ")}`);
      assert(alerts.some((x) => x.startsWith("🛠 <b>ตั้งค่า SMS ไม่ถูกต้อง ส่งรหัสไม่ได้</b>") && x.includes("(รหัส 9)")), `settings alert: ${alerts.join(" | ")}`);

      // low credit: the send works and the administrators are told once
      await smsControl("credit", { balance: 50 });
      await page.fill("#phone", DOC2);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="otp-info"]');
      const sms = await waitForSms(DOC2, seenSms);
      await smsControl("credit", { balance: 5000 });
      const low = await waitUntil(async () => (await telegramMessages()).slice(tgBefore).find((m) => m.text.startsWith("💳 <b>เครดิต SMS ใกล้หมด</b>")), "low credit alert");
      assert(low.text.includes("เหลือ 49 เครดิต"), `low credit: ${low.text}`);

      // deeSMSX down while checking: "try again", the typed code stays, the attempt is not counted
      await smsControl("fail", { mode: "101" });
      await page.fill("#code", sms.pin);
      await page.waitForSelector('[data-testid="otp-error"]');
      assert((await page.textContent('[data-testid="otp-error"]')).includes("เกิดข้อผิดพลาด"), "outage message");
      assert((await page.inputValue("#code")) === sms.pin, "the code is kept for another try");
      const att = await db.query("SELECT attempts FROM otp_codes WHERE line_sub = $1", [SUB_I]);
      assert(att.rows[0].attempts === 0, `attempt refunded: ${att.rows[0].attempts}`);
      await page.click('form button[type="submit"]');
      await page.waitForURL(`${APP}/`);
      assert((await boardName(page)) === DOC2_NAME, "signed in on the second try");
      await ctx.close();
    });

    await t("tampered state -> friendly error page, no session; cancelled login -> error page", async () => {
      await setIdentity({ sub: SUB_A, name: LINE_NAME_A });
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
      await setIdentity({ sub: SUB_A, name: LINE_NAME_A });
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
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND phone = $2 AND event = 'logout'", [SUB_A, DOC1]);
      assert(ev.rowCount === 1, "logout event logged");
      await ctxA.close();
    });

    await t("CSRF: POST without/with foreign Origin is rejected; non-JSON rejected", async () => {
      for (const path of ["/api/auth/otp/send", "/api/auth/otp/verify", "/api/auth/logout", "/api/auth/access/request", "/api/auth/access/complete", "/"]) {
        const none = await postJson(path, { phone: DOC1 });
        assert(none.status === 403, `${path} without Origin -> ${none.status}`);
        const evil = await postJson(path, { phone: DOC1 }, { origin: "https://evil.test" });
        assert(evil.status === 403, `${path} foreign Origin -> ${evil.status}`);
      }
      const ref = await postJson("/api/auth/logout", {}, { referer: "https://evil.test/x" });
      assert(ref.status === 403, "foreign Referer rejected");
      const text = await fetch(`${APP}/api/auth/otp/send`, {
        method: "POST",
        headers: { origin: APP, "content-type": "text/plain" },
        body: JSON.stringify({ phone: DOC1 }),
      });
      assert(text.status === 415, `text/plain -> ${text.status}`);
      const noPending = await postJson("/api/auth/otp/send", { phone: DOC1 }, { origin: APP });
      assert(noPending.status === 401, `no pending cookie -> ${noPending.status}`);
      for (const path of ["/api/auth/access/request", "/api/auth/access/complete"]) {
        const noAccess = await postJson(path, {}, { origin: APP });
        assert(noAccess.status === 401, `${path} without access cookie -> ${noAccess.status}`);
      }
      // the Telegram webhook takes no Origin (server to server) but needs the secret header
      const hook = await postJson(WEBHOOK_PATH, { update_id: 1 });
      assert(hook.status === 401, `webhook without Origin and secret -> ${hook.status}`);
    });

    await t("forged, unlisted or pre-SMS session tokens are rejected; the break-glass ALLOWED_PHONES still works", async () => {
      for (const phone of [DOC1, BREAK_GLASS]) {
        const ok = await rawRequest("/", { host: `localhost:${APP_PORT}`, cookie: `session=${await sessionToken(phone)}` });
        assert(ok.status === 200, `valid token for ${fmt(phone)} -> ${ok.status}`);
      }
      const legacy = await new SignJWT({ email: "someone@example.com", name: "x", picture: null })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("Ux")
        .setIssuer("orskh")
        .setAudience("session")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(SESSION_SECRET));
      for (const token of [
        await sessionToken("0899999999"),
        await sessionToken(fmt(DOC1)), // not the canonical form the app signs
        await sessionToken(DOC1, "wrong-secret-wrong-secret-wrong-secret"),
        legacy,
      ]) {
        const r = await rawRequest("/", { host: `localhost:${APP_PORT}`, cookie: `session=${token}` });
        assert(r.status === 307 && r.location?.startsWith("/login"), `rejected -> ${r.status}`);
      }
    });

    await t("admin: the button and menu link only for a sub in AUTH_ADMIN_LINE_IDS; /admin is 404 for everyone else", async () => {
      const headers = (token) => ({ host: `localhost:${APP_PORT}`, cookie: `session=${token}` });
      const anon = await rawRequest("/admin", { host: `localhost:${APP_PORT}` });
      assert(anon.status === 307 && anon.location === "/login?next=%2Fadmin", `signed out: ${anon.status} ${anon.location}`);
      // signed in with an authorized number but a sub that is not an admin: same page as a mistyped address
      for (const token of [await sessionToken(DOC1), await sessionToken(DOC1, SESSION_SECRET, SUB_A)]) {
        const r = await rawRequest("/admin", headers(token));
        assert(r.status === 404, `non-admin /admin -> ${r.status}`);
        const html = await (await fetch(`${APP}/`, { headers: { cookie: `session=${token}` } })).text();
        assert(!html.includes('href="/admin"'), "no admin link on a non-admin's board");
      }
      // an admin sub with a number that is not authorized gets no session at all
      const unlisted = await rawRequest("/admin", headers(await sessionToken("0899999999", SESSION_SECRET, ADMIN_SUB)));
      assert(unlisted.status === 307 && unlisted.location?.startsWith("/login"), `admin sub, unlisted number -> ${unlisted.status}`);

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

    await t("local file mode (SMS_PROVIDER=file): the app makes the code, writes the SMS to a file; SMS_DAILY_CAP stops sending", async () => {
      // the same build, a second server: local mode, and a daily cap two sends above what was sent so far
      const sent = (await db.query("SELECT count(*)::int AS n FROM otp_codes WHERE created_at > now() - interval '24 hours'")).rows[0].n;
      const cap = sent + 2;
      const fileEnv = { ...appEnv, APP_URL: FILE_APP, SMS_PROVIDER: "file", SMS_OUTBOX_DIR: OUTBOX, SMS_DAILY_CAP: String(cap) };
      for (const k of ["DEESMSX_API_KEY", "DEESMSX_SECRET_KEY", "DEESMSX_API_URL"]) delete fileEnv[k];
      fileApp = startProcess("app-file", ["node_modules/next/dist/bin/next", "start", "-p", String(FILE_APP_PORT)], fileEnv);
      await waitFor(`${FILE_APP}/login`, fileApp);
      const smsBefore = (await smsIssued()).length;
      const tgBefore = (await telegramMessages()).length;

      // 1: a full sign-in with the code from the file
      await setIdentity({ sub: SUB_J, name: "หมอสาม" });
      let ctx = await newContext(browser);
      let page = await ctx.newPage();
      await lineLogin(page, undefined, FILE_APP);
      assert(new URL(page.url()).pathname === "/login/verify", `at ${page.url()}`);
      await page.fill("#phone", fmt(DOC1));
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="otp-info"]');
      const file = await waitForSmsFile(DOC1, seenFiles);
      assert(/^\d{6}$/.test(file.code) && /^[A-Z2-9]{4}$/.test(file.ref) && !Number.isNaN(Date.parse(file.at)), `file: ${JSON.stringify({ ref: file.ref, at: file.at })}`);
      assert(file.text === `รหัส ORSKH ของคุณคือ ${file.code} ใช้ได้ 5 นาที ห้ามบอกผู้อื่น`, `SMS text: ${file.text}`);
      assert(!/https?:|www\.|\.com|\.app/i.test(file.text) && file.text.length <= 70, "one SMS, no link");
      assert((await page.textContent('[data-testid="otp-ref"]')) === file.ref, "the file's reference is on screen");
      const row = await db.query("SELECT code_hash, provider_token FROM otp_codes WHERE line_sub = $1", [SUB_J]);
      assert(row.rows[0].code_hash && !row.rows[0].code_hash.includes(file.code) && row.rows[0].provider_token === null, "local mode stores an HMAC only");
      await page.fill("#code", file.code);
      await page.waitForURL(`${FILE_APP}/`);
      assert((await boardName(page)) === DOC1_NAME, `signed in by file mode: ${await boardName(page)}`);
      await ctx.close();

      // 2: the second send reaches the cap exactly
      await setIdentity({ sub: SUB_K, name: "คนที่สอง" });
      ctx = await newContext(browser);
      page = await ctx.newPage();
      await lineLogin(page, undefined, FILE_APP);
      await page.fill("#phone", UNLISTED);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="otp-info"]');
      await waitForSmsFile(UNLISTED, seenFiles);
      await ctx.close();

      // 3: over the cap: nobody gets a code, a Thai message, the administrators are told
      await setIdentity({ sub: SUB_L, name: "คนที่สาม" });
      ctx = await newContext(browser);
      page = await ctx.newPage();
      await lineLogin(page, undefined, FILE_APP);
      const files = outboxFiles().length;
      await page.fill("#phone", CAPPED);
      await page.click('button[type="submit"]');
      await page.waitForSelector("#phone-error");
      const err = (await page.textContent("#phone-error")).trim();
      assert(err === "ระบบส่ง SMS ครบจำนวนของวันนี้แล้ว กรุณาลองใหม่ภายหลัง หรือติดต่อผู้ดูแล", `cap message: ${err}`);
      assert((await page.getAttribute("#phone", "aria-invalid")) === null, "the cap does not mark a valid number invalid");
      await sleep(500);
      assert(outboxFiles().length === files, "nothing sent over the cap");
      const capAlert = await waitUntil(
        async () => (await telegramMessages()).slice(tgBefore).find((m) => m.text.startsWith("🛑 <b>ส่ง SMS ครบเพดานของวันแล้ว หยุดส่งรหัส</b>")),
        "cap alert",
      );
      assert(capAlert.text.includes(`ส่งครบ ${cap.toLocaleString("en-US")} ครั้ง`), `cap alert: ${capAlert.text}`);
      const capEv = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND phone = $2 AND event = 'otp_daily_cap'", [SUB_L, CAPPED]);
      assert(capEv.rowCount === 1, "otp_daily_cap logged");
      assert((await db.query("SELECT 1 FROM otp_codes WHERE line_sub = $1", [SUB_L])).rowCount === 0, "no row over the cap");
      assert((await smsIssued()).length === smsBefore, "file mode never calls deeSMSX");
      await ctx.close();
    });

    await t("no OTP code, deeSMSX token or key appears in server logs", async () => {
      assert(issuedCodes.length >= 20, `codes and tokens collected: ${issuedCodes.length}`);
      for (const proc of [app, fileApp].filter(Boolean)) {
        const log = proc.log();
        for (const code of issuedCodes) assert(!log.includes(code), `code or token found in the ${proc.name} log`);
        assert(!log.includes(SESSION_SECRET) && !log.includes(OTP_PEPPER) && !log.includes(TG_TOKEN), `secret in the ${proc.name} log`);
        assert(!log.includes(SMS_API_KEY) && !log.includes(SMS_SECRET_KEY), `deeSMSX key in the ${proc.name} log`);
        assert(webhookSecret && !log.includes(webhookSecret), `webhook secret in the ${proc.name} log`);
      }
      assert(/\[sms\] deeSMSX OTP request failed: code 102/.test(app.log()), "provider failures are logged by reference code");
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
