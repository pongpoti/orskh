import "./_setup";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import type { Pool } from "pg";
import { isAuthorizedPhone, isListedUser, LIST_TTL_MS, noteAuthorized, noteRevoked, resetAuthzCache, RETRY_MS } from "@/lib/authz";
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

async function approve(phone: string, status = "approved") {
  await (await pool()).query(
    `INSERT INTO access_requests (phone, line_sub, first_name, last_name, position, status, decided_at)
     VALUES ($1, 'U1', 'ก', 'ข', 'RN', $2, now())`,
    [phone, status],
  );
}

/** A user (active or not) with a current claim of the number (each user gets its own invented name). */
async function claimed(phone: string, active = true) {
  const p = await pool();
  const { rows } = await p.query<{ id: string }>(
    "INSERT INTO users (first_name, last_name, type, subtype, active) VALUES ('ทดสอบ', $1, 'DR', 'ORTHO', $2) RETURNING id::text AS id",
    [phone, active],
  );
  await p.query("INSERT INTO user_claims (user_id, phone, line_sub) VALUES ($1, $2, $3)", [rows[0].id, phone, `U-${phone}`]);
}

/** Activates or deactivates the user whose current claim holds the number (as the sync script does). */
async function setActive(phone: string, active: boolean) {
  await (await pool()).query(
    "UPDATE users SET active = $2, updated_at = now() WHERE id IN (SELECT user_id FROM user_claims WHERE phone = $1 AND undone_at IS NULL)",
    [phone, active],
  );
}

/** Ends the number's current claim (as the undo button does). */
async function undo(phone: string) {
  await (await pool()).query(
    "UPDATE user_claims SET undone_at = now(), undone_by = 111, undo_reason = 'admin' WHERE phone = $1 AND undone_at IS NULL",
    [phone],
  );
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
  await (await pool()).query("TRUNCATE access_requests, user_claims, users");
}

describe("authorization: a number with a current claim on an active user (a claimed name) or an approved access request (or ALLOWED_PHONES)", () => {
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

  test("break-glass ALLOWED_PHONES never needs the database", async () => {
    process.env.DATABASE_URL = DOWN;
    const { value, logged } = await quietly(async () => [
      await isAuthorizedPhone(" +66 90 000 0002 "),
      await isAuthorizedPhone("0611111111", { fresh: true }),
      await isAuthorizedPhone("0910000003"),
    ]);
    assert.deepEqual(value, [true, true, false]);
    assert.equal(logged.length, 1, "only the non-listed number tried the database");
    assert.match(logged[0], /phone list unavailable/);
    assert.equal(await isAuthorizedPhone("not a number"), false);
  });

  test("ALLOWED_PHONES is optional: unset or empty adds nobody, and the table still authorizes", async () => {
    await claimed("0910000001");
    for (const raw of [undefined, "", "  "]) {
      resetAuthzCache();
      if (raw === undefined) delete process.env.ALLOWED_PHONES;
      else process.env.ALLOWED_PHONES = raw;
      assert.equal(await isAuthorizedPhone("0812345678"), false, `ALLOWED_PHONES=${JSON.stringify(raw)}`);
      assert.equal(await isAuthorizedPhone("091-000-0001"), true);
      assert.equal(await isAuthorizedPhone("0910000001", { fresh: true }), true);
    }
  });

  test("a current claim on an active user authorizes; a claim on an inactive user, an ended claim and unknown numbers do not", async () => {
    await claimed("0910000001");
    await claimed("0910000004", false);
    assert.equal(await isAuthorizedPhone(" 091 000 0001 "), true);
    assert.equal(await isAuthorizedPhone("0910000004"), false);
    assert.equal(await isAuthorizedPhone("0910000013"), false);
    assert.equal(await isAuthorizedPhone("0910000001", { fresh: true }), true);
    assert.equal(await isAuthorizedPhone("0910000004", { fresh: true }), false);
    await claimed("0910000014");
    await undo("0910000014");
    assert.equal(await isAuthorizedPhone("0910000014", { fresh: true }), false, "an undone claim");
  });

  test("approved requests authorize; pending and rejected ones do not", async () => {
    await approve("0910000002");
    await approve("0910000005", "pending");
    await approve("0910000006", "rejected");
    assert.equal(await isAuthorizedPhone("+66910000002"), true);
    assert.equal(await isAuthorizedPhone("0910000005"), false);
    assert.equal(await isAuthorizedPhone("0910000006"), false);
  });

  test("one cached list holds claimed names and approved requests", async () => {
    await claimed("0910000001");
    await approve("0910000002");
    assert.equal(await isAuthorizedPhone("0910000001"), true); // loads the list
    process.env.DATABASE_URL = DOWN;
    const { value, logged } = await quietly(async () => [
      await isAuthorizedPhone("0910000001"),
      await isAuthorizedPhone("0910000002"),
    ]);
    assert.deepEqual([value, logged], [[true, true], []], "both answered from the cached list");
  });

  test("cache: deactivating a claimed name (active = false) applies once the cached list expires, or after a reset", async () => {
    await claimed("0910000001");
    assert.equal(await isAuthorizedPhone("0910000001"), true);
    await setActive("0910000001", false);
    assert.equal(await isAuthorizedPhone("0910000001"), true, "still cached");
    advance(LIST_TTL_MS - 1000);
    assert.equal(await isAuthorizedPhone("0910000001"), true, "within the cache window");
    advance(1000);
    assert.equal(await isAuthorizedPhone("0910000001"), false, "reloaded after the window");
    // back on the list: found once the remembered miss expires
    await setActive("0910000001", true);
    advance(RETRY_MS);
    assert.equal(await isAuthorizedPhone("0910000001"), true);
    // a fresh instance (empty cache) sees a removal at once
    await setActive("0910000001", false);
    resetAuthzCache();
    assert.equal(await isAuthorizedPhone("0910000001"), false);
  });

  test("cache: a fresh check that reads a removal also drops the number from this instance's cached list", async () => {
    await claimed("0910000001");
    await approve("0910000002");
    assert.equal(await isAuthorizedPhone("0910000001"), true); // loads the list
    await setActive("0910000001", false);
    await (await pool()).query("UPDATE access_requests SET status = 'rejected' WHERE phone = '0910000002'");
    // e.g. the code check: the database says no ...
    assert.equal(await isAuthorizedPhone("0910000001", { fresh: true }), false);
    assert.equal(await isAuthorizedPhone("0910000002", { fresh: true }), false);
    // ... so the LINE fast path and the session check on this instance say no too, before the list expires
    assert.equal(await isAuthorizedPhone("0910000001"), false);
    assert.equal(await isAuthorizedPhone("0910000002"), false);
    // a failed read removes nobody from the list (the cached list answers until it expires, as before)
    await setActive("0910000001", true);
    advance(RETRY_MS);
    assert.equal(await isAuthorizedPhone("0910000001"), true);
    process.env.DATABASE_URL = DOWN;
    const down = await quietly(() => isAuthorizedPhone("0910000001", { fresh: true }));
    assert.equal(down.value, false);
    assert.equal(await isAuthorizedPhone("0910000001"), true, "still in the cached list");
  });

  test("cache: a revoked request applies once the cached list expires", async () => {
    await approve("0910000002");
    assert.equal(await isAuthorizedPhone("0910000002"), true);
    await (await pool()).query("UPDATE access_requests SET status = 'rejected', decided_at = now() WHERE phone = '0910000002'");
    assert.equal(await isAuthorizedPhone("0910000002"), true, "still cached");
    advance(LIST_TTL_MS - 1000);
    assert.equal(await isAuthorizedPhone("0910000002"), true, "within the cache window");
    advance(1000);
    assert.equal(await isAuthorizedPhone("0910000002"), false, "reloaded after the window");
  });

  test("cache: a number added or approved after the list was loaded is found at once, by a lookup of that number", async () => {
    // the list is loaded for another number (e.g. another approved user's request on this instance) ...
    assert.equal(await isAuthorizedPhone("0910000007"), false);
    // ... then someone claims a name or is approved elsewhere (the webhook and
    // /api/auth/access/complete run in other functions than the proxy on Vercel, so noteAuthorized() never reaches
    // this cache)
    await claimed("0910000008");
    await approve("0910000009");
    assert.equal(await isAuthorizedPhone("0910000008"), true, "no wait for a reload");
    assert.equal(await isAuthorizedPhone("0910000009"), true, "no wait for a reload");
    assert.equal(await isAuthorizedPhone("0910000009"), true, "now in the cached list");
    // fresh: true reads the database right away
    await approve("0910000010");
    assert.equal(await isAuthorizedPhone("0910000010", { fresh: true }), true);
    // this instance learns about its own approvals immediately
    process.env.DATABASE_URL = DOWN;
    noteAuthorized("091-000-0011");
    assert.equal(await isAuthorizedPhone("0910000011"), true);
  });

  test("cache: a miss is remembered for RETRY_MS, so a revoked session cannot query the database on every request", async () => {
    assert.equal(await isAuthorizedPhone("0910000012"), false);
    process.env.DATABASE_URL = DOWN;
    const again = await quietly(() => isAuthorizedPhone("0910000012"));
    assert.deepEqual([again.value, again.logged], [false, []], "answered from memory");
    process.env.DATABASE_URL = TEST_DB;
    await claimed("0910000012"); // listed after the miss
    assert.equal(await isAuthorizedPhone("0910000012"), false, "within RETRY_MS of the miss");
    advance(RETRY_MS);
    assert.equal(await isAuthorizedPhone("0910000012"), true);
    // noteAuthorized() forgets the miss on this instance
    assert.equal(await isAuthorizedPhone("0910000005"), false);
    noteAuthorized("0910000005");
    assert.equal(await isAuthorizedPhone("0910000005"), true);
  });

  test("concurrent checks while the list loads wait for that load (cold and expired cache)", async () => {
    await claimed("0910000001");
    await approve("0910000002");
    const four = (phone: string) => Promise.all(Array.from({ length: 4 }, () => isAuthorizedPhone(phone)));
    assert.deepEqual(await four("0910000002"), [true, true, true, true], "cold cache");
    advance(LIST_TTL_MS);
    assert.deepEqual(await four("0910000001"), [true, true, true, true], "expired cache being reloaded");
    // removed numbers are refused by all of them
    await (await pool()).query("UPDATE access_requests SET status = 'rejected' WHERE phone = '0910000002'");
    await setActive("0910000001", false);
    advance(LIST_TTL_MS);
    assert.deepEqual(await four("0910000002"), [false, false, false, false]);
    assert.deepEqual(await four("0910000001"), [false, false, false, false]);
  });

  test("fail closed: with the database down, table-only and approved-only numbers stop working after the cache window", async () => {
    await claimed("0910000001");
    await approve("0910000002");
    assert.equal(await isAuthorizedPhone("0910000002"), true);
    process.env.DATABASE_URL = DOWN;
    assert.equal(await isAuthorizedPhone("0910000001"), true, "cached list still valid");
    advance(LIST_TTL_MS);
    const down = await quietly(async () => [
      await isAuthorizedPhone("0910000001"),
      await isAuthorizedPhone("0910000002"),
      await isAuthorizedPhone("0910000001", { fresh: true }),
      await isAuthorizedPhone("0812345678"),
    ]);
    assert.deepEqual(down.value, [false, false, false, true]);
    assert.ok(down.logged.length >= 1 && down.logged.every((l) => !l.includes("postgres:postgres")), "no credentials logged");
    // back up: authorized again on the next attempt
    process.env.DATABASE_URL = TEST_DB;
    advance(RETRY_MS);
    assert.equal(await isAuthorizedPhone("0910000001"), true);
    assert.equal(await isAuthorizedPhone("0910000002"), true);
  });

  test("isListedUser: ALLOWED_PHONES or an active row, read now (not cached); a failed read is not listed", async () => {
    await claimed("0910000001");
    await claimed("0910000004", false);
    await approve("0910000002");
    assert.equal(await isListedUser("091-000-0001"), true);
    assert.equal(await isListedUser("0910000004"), false);
    assert.equal(await isListedUser("0910000002"), false, "an approved request holds no name");
    assert.equal(await isListedUser("not a number"), false);
    // a change is seen at once, whatever the authorization cache holds
    assert.equal(await isAuthorizedPhone("0910000001"), true);
    await setActive("0910000001", false);
    await setActive("0910000004", true);
    assert.equal(await isListedUser("0910000001"), false);
    assert.equal(await isListedUser("0910000004"), true);
    // database down: the break-glass list still answers, everything else is not listed
    process.env.DATABASE_URL = DOWN;
    const down = await quietly(async () => [
      await isListedUser("0611111111"),
      await isListedUser("0910000004"),
    ]);
    assert.deepEqual(down.value, [true, false]);
    assert.equal(down.logged.length, 1);
    assert.match(down.logged[0], /claim check unavailable/);
  });

  test("noteRevoked: an undone claim stops working on this instance at once; other instances drop it with their next reload", async () => {
    await claimed("0910000020");
    assert.equal(await isAuthorizedPhone("0910000020"), true); // in the cached list
    // the undo ends the claim (on this instance)
    await undo("0910000020");
    assert.equal(await isAuthorizedPhone("0910000020"), true, "still cached before noteRevoked");
    noteRevoked("091-000-0020");
    assert.equal(await isAuthorizedPhone("0910000020"), false, "read again from the database");
    noteRevoked("not a number"); // ignored
    // another instance (a fresh cache loaded before the undo) still answers from its list until it expires
    await claimed("0910000021");
    assert.equal(await isAuthorizedPhone("0910000021"), true);
    await undo("0910000021");
    advance(LIST_TTL_MS);
    assert.equal(await isAuthorizedPhone("0910000021"), false, "dropped by the reload");
  });
});
