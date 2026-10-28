import "./_setup";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import type { Pool } from "pg";
import { isAuthorizedEmail, isListedPhysician, LIST_TTL_MS, noteApproved, resetAuthzCache, RETRY_MS } from "@/lib/authz";
import { db } from "@/lib/db";
import { setTestEnv, TEST_DB } from "./_setup";

const DOWN = "postgres://postgres:postgres@127.0.0.1:9/nothing_listens_here";
const realNow = Date.now;
let offset = 0;

/** Moves the clock lib/authz.ts sees. */
function advance(ms: number) {
  offset += ms;
  Date.now = () => realNow() + offset;
}

// lib/db.ts opens a new pool whenever DATABASE_URL changes: keep every pool to close it at the end.
const pools = new Set<Pool>();
async function pool(): Promise<Pool> {
  const p = await db();
  pools.add(p);
  return p;
}

async function approve(email: string, status = "approved") {
  await (await pool()).query(
    `INSERT INTO access_requests (email, line_sub, first_name, last_name, position, status, decided_at)
     VALUES ($1, 'U1', 'ก', 'ข', 'nurse', $2, now())`,
    [email, status],
  );
}

async function physician(email: string, active = true) {
  await (await pool()).query("INSERT INTO physicians (email, name, dept, active) VALUES ($1, 'สมชาย ใจดี', NULL, $2)", [
    email,
    active,
  ]);
}

async function setActive(email: string, active: boolean) {
  await (await pool()).query("UPDATE physicians SET active = $2, updated_at = now() WHERE email = $1", [email, active]);
}

/** Captures console.error (expected while the database is down). */
async function quietly<T>(fn: () => Promise<T>): Promise<{ value: T; logged: string[] }> {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
  try {
    return { value: await fn(), logged };
  } finally {
    console.error = orig;
  }
}

async function clear() {
  await (await pool()).query("TRUNCATE access_requests, physicians");
}

describe("authorization: an active physicians row or an approved access request (or ALLOWED_EMAILS)", () => {
  before(clear);
  beforeEach(() => resetAuthzCache());
  afterEach(async () => {
    Date.now = realNow;
    offset = 0;
    setTestEnv();
    await clear();
  });
  after(async () => {
    await pool();
    await Promise.all([...pools].map((p) => p.end().catch(() => {})));
  });

  test("break-glass ALLOWED_EMAILS never needs the database", async () => {
    process.env.DATABASE_URL = DOWN;
    const { value, logged } = await quietly(async () => [
      await isAuthorizedEmail(" DOC2@example.com "),
      await isAuthorizedEmail("third@example.com", { fresh: true }),
      await isAuthorizedEmail("newcomer@example.com"),
    ]);
    assert.deepEqual(value, [true, true, false]);
    assert.equal(logged.length, 1, "only the non-listed email tried the database");
    assert.match(logged[0], /email list unavailable/);
    assert.equal(await isAuthorizedEmail("not an email"), false);
  });

  test("ALLOWED_EMAILS is optional: unset or empty adds nobody, and the table still authorizes", async () => {
    await physician("doc@example.com");
    for (const raw of [undefined, "", "  "]) {
      resetAuthzCache();
      if (raw === undefined) delete process.env.ALLOWED_EMAILS;
      else process.env.ALLOWED_EMAILS = raw;
      assert.equal(await isAuthorizedEmail("doc.one@example.com"), false, `ALLOWED_EMAILS=${JSON.stringify(raw)}`);
      assert.equal(await isAuthorizedEmail("Doc@Example.com"), true);
      assert.equal(await isAuthorizedEmail("doc@example.com", { fresh: true }), true);
    }
  });

  test("active physicians rows authorize; inactive rows and unknown emails do not", async () => {
    await physician("doc@example.com");
    await physician("retired@example.com", false);
    assert.equal(await isAuthorizedEmail(" Doc@Example.com "), true);
    assert.equal(await isAuthorizedEmail("retired@example.com"), false);
    assert.equal(await isAuthorizedEmail("nobody@example.com"), false);
    assert.equal(await isAuthorizedEmail("doc@example.com", { fresh: true }), true);
    assert.equal(await isAuthorizedEmail("retired@example.com", { fresh: true }), false);
  });

  test("approved requests authorize; pending and rejected ones do not", async () => {
    await approve("nurse@example.com");
    await approve("waiting@example.com", "pending");
    await approve("refused@example.com", "rejected");
    assert.equal(await isAuthorizedEmail("Nurse@Example.com"), true);
    assert.equal(await isAuthorizedEmail("waiting@example.com"), false);
    assert.equal(await isAuthorizedEmail("refused@example.com"), false);
  });

  test("one cached list holds active physicians and approved requests", async () => {
    await physician("doc@example.com");
    await approve("nurse@example.com");
    assert.equal(await isAuthorizedEmail("doc@example.com"), true); // loads the list
    process.env.DATABASE_URL = DOWN;
    const { value, logged } = await quietly(async () => [
      await isAuthorizedEmail("doc@example.com"),
      await isAuthorizedEmail("nurse@example.com"),
    ]);
    assert.deepEqual([value, logged], [[true, true], []], "both answered from the cached list");
  });

  test("cache: removing a physician (active = false) applies once the cached list expires, or after a reset", async () => {
    await physician("doc@example.com");
    assert.equal(await isAuthorizedEmail("doc@example.com"), true);
    await setActive("doc@example.com", false);
    assert.equal(await isAuthorizedEmail("doc@example.com"), true, "still cached");
    advance(LIST_TTL_MS - 1000);
    assert.equal(await isAuthorizedEmail("doc@example.com"), true, "within the cache window");
    advance(1000);
    assert.equal(await isAuthorizedEmail("doc@example.com"), false, "reloaded after the window");
    // back on the list: found once the remembered miss expires
    await setActive("doc@example.com", true);
    advance(RETRY_MS);
    assert.equal(await isAuthorizedEmail("doc@example.com"), true);
    // a fresh instance (empty cache) sees a removal at once
    await setActive("doc@example.com", false);
    resetAuthzCache();
    assert.equal(await isAuthorizedEmail("doc@example.com"), false);
  });

  test("cache: a fresh check that reads a removal also drops the email from this instance's cached list", async () => {
    await physician("doc@example.com");
    await approve("nurse@example.com");
    assert.equal(await isAuthorizedEmail("doc@example.com"), true); // loads the list
    await setActive("doc@example.com", false);
    await (await pool()).query("UPDATE access_requests SET status = 'rejected' WHERE email = 'nurse@example.com'");
    // e.g. the code check: the database says no ...
    assert.equal(await isAuthorizedEmail("doc@example.com", { fresh: true }), false);
    assert.equal(await isAuthorizedEmail("nurse@example.com", { fresh: true }), false);
    // ... so the LINE fast path and the session check on this instance say no too, before the list expires
    assert.equal(await isAuthorizedEmail("doc@example.com"), false);
    assert.equal(await isAuthorizedEmail("nurse@example.com"), false);
    // a failed read removes nobody from the list (the cached list answers until it expires, as before)
    await setActive("doc@example.com", true);
    advance(RETRY_MS);
    assert.equal(await isAuthorizedEmail("doc@example.com"), true);
    process.env.DATABASE_URL = DOWN;
    const down = await quietly(() => isAuthorizedEmail("doc@example.com", { fresh: true }));
    assert.equal(down.value, false);
    assert.equal(await isAuthorizedEmail("doc@example.com"), true, "still in the cached list");
  });

  test("cache: a revoked request applies once the cached list expires", async () => {
    await approve("nurse@example.com");
    assert.equal(await isAuthorizedEmail("nurse@example.com"), true);
    await (await pool()).query("UPDATE access_requests SET status = 'rejected', decided_at = now() WHERE email = 'nurse@example.com'");
    assert.equal(await isAuthorizedEmail("nurse@example.com"), true, "still cached");
    advance(LIST_TTL_MS - 1000);
    assert.equal(await isAuthorizedEmail("nurse@example.com"), true, "within the cache window");
    advance(1000);
    assert.equal(await isAuthorizedEmail("nurse@example.com"), false, "reloaded after the window");
  });

  test("cache: an email added or approved after the list was loaded is found at once, by a lookup of that email", async () => {
    // the list is loaded for another email (e.g. another approved user's request on this instance) ...
    assert.equal(await isAuthorizedEmail("other@example.com"), false);
    // ... then someone is added to the table (by SQL or the sync script) or approved elsewhere (the webhook and
    // /api/auth/access/complete run in other functions than the proxy on Vercel, so noteApproved() never reaches
    // this cache)
    await physician("new.doc@example.com");
    await approve("late@example.com");
    assert.equal(await isAuthorizedEmail("new.doc@example.com"), true, "no wait for a reload");
    assert.equal(await isAuthorizedEmail("late@example.com"), true, "no wait for a reload");
    assert.equal(await isAuthorizedEmail("late@example.com"), true, "now in the cached list");
    // fresh: true reads the database right away
    await approve("now@example.com");
    assert.equal(await isAuthorizedEmail("now@example.com", { fresh: true }), true);
    // this instance learns about its own approvals immediately
    process.env.DATABASE_URL = DOWN;
    noteApproved("Instant@Example.com");
    assert.equal(await isAuthorizedEmail("instant@example.com"), true);
  });

  test("cache: a miss is remembered for RETRY_MS, so a revoked session cannot query the database on every request", async () => {
    assert.equal(await isAuthorizedEmail("revoked@example.com"), false);
    process.env.DATABASE_URL = DOWN;
    const again = await quietly(() => isAuthorizedEmail("revoked@example.com"));
    assert.deepEqual([again.value, again.logged], [false, []], "answered from memory");
    process.env.DATABASE_URL = TEST_DB;
    await physician("revoked@example.com"); // listed after the miss
    assert.equal(await isAuthorizedEmail("revoked@example.com"), false, "within RETRY_MS of the miss");
    advance(RETRY_MS);
    assert.equal(await isAuthorizedEmail("revoked@example.com"), true);
    // noteApproved() forgets the miss on this instance
    assert.equal(await isAuthorizedEmail("waiting@example.com"), false);
    noteApproved("waiting@example.com");
    assert.equal(await isAuthorizedEmail("waiting@example.com"), true);
  });

  test("concurrent checks while the list loads wait for that load (cold and expired cache)", async () => {
    await physician("doc@example.com");
    await approve("nurse@example.com");
    const four = (email: string) => Promise.all(Array.from({ length: 4 }, () => isAuthorizedEmail(email)));
    assert.deepEqual(await four("nurse@example.com"), [true, true, true, true], "cold cache");
    advance(LIST_TTL_MS);
    assert.deepEqual(await four("doc@example.com"), [true, true, true, true], "expired cache being reloaded");
    // removed emails are refused by all of them
    await (await pool()).query("UPDATE access_requests SET status = 'rejected' WHERE email = 'nurse@example.com'");
    await setActive("doc@example.com", false);
    advance(LIST_TTL_MS);
    assert.deepEqual(await four("nurse@example.com"), [false, false, false, false]);
    assert.deepEqual(await four("doc@example.com"), [false, false, false, false]);
  });

  test("fail closed: with the database down, table-only and approved-only emails stop working after the cache window", async () => {
    await physician("doc@example.com");
    await approve("nurse@example.com");
    assert.equal(await isAuthorizedEmail("nurse@example.com"), true);
    process.env.DATABASE_URL = DOWN;
    assert.equal(await isAuthorizedEmail("doc@example.com"), true, "cached list still valid");
    advance(LIST_TTL_MS);
    const down = await quietly(async () => [
      await isAuthorizedEmail("doc@example.com"),
      await isAuthorizedEmail("nurse@example.com"),
      await isAuthorizedEmail("doc@example.com", { fresh: true }),
      await isAuthorizedEmail("doc.one@example.com"),
    ]);
    assert.deepEqual(down.value, [false, false, false, true]);
    assert.ok(down.logged.length >= 1 && down.logged.every((l) => !l.includes("postgres:postgres")), "no credentials logged");
    // back up: authorized again on the next attempt
    process.env.DATABASE_URL = TEST_DB;
    advance(RETRY_MS);
    assert.equal(await isAuthorizedEmail("doc@example.com"), true);
    assert.equal(await isAuthorizedEmail("nurse@example.com"), true);
  });

  test("isListedPhysician: ALLOWED_EMAILS or an active row, read now (not cached); a failed read is not listed", async () => {
    await physician("doc@example.com");
    await physician("retired@example.com", false);
    await approve("nurse@example.com");
    assert.equal(await isListedPhysician("Doc@Example.com"), true);
    assert.equal(await isListedPhysician("retired@example.com"), false);
    assert.equal(await isListedPhysician("nurse@example.com"), false, "an approved request is not the physician list");
    assert.equal(await isListedPhysician("not an email"), false);
    // a change is seen at once, whatever the authorization cache holds
    assert.equal(await isAuthorizedEmail("doc@example.com"), true);
    await setActive("doc@example.com", false);
    await setActive("retired@example.com", true);
    assert.equal(await isListedPhysician("doc@example.com"), false);
    assert.equal(await isListedPhysician("retired@example.com"), true);
    // database down: the break-glass list still answers, everything else is not listed
    process.env.DATABASE_URL = DOWN;
    const down = await quietly(async () => [
      await isListedPhysician("third@example.com"),
      await isListedPhysician("retired@example.com"),
    ]);
    assert.deepEqual(down.value, [true, false]);
    assert.equal(down.logged.length, 1);
    assert.match(down.logged[0], /physician check unavailable/);
  });
});
