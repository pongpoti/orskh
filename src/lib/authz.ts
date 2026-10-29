import "server-only";
import { approvedPhones, isApproved } from "./access";
import { db } from "./db";
import { isAllowedPhone, normalizePhone } from "./phone";
import { activePhones, holdsActiveName } from "./user-list";

/**
 * Who may open the board: a mobile number with a current claim on an active user of the `users` table (a claimed name) OR with an
 * approved access request, or one in the optional break-glass ALLOWED_PHONES (env, never needs the database). The
 * database part is one list (numbers of active claimed names + approved requests), cached per server instance:
 * - the list is reloaded at least every LIST_TTL_MS, so a removal (active = false), an undone claim or a revoked
 *   request applies within that time on every instance (at once on the instance that undid the claim:
 *   noteRevoked(), shared by every route of the process); callers that arrive while a reload runs wait for it (never answered from a missing or expired
 *   list);
 * - a number missing from a current list is looked up on its own (two indexed queries): it may have been added or
 *   approved since, possibly on another instance (on Vercel the proxy never sees the webhook's noteAuthorized()).
 *   A miss is remembered for RETRY_MS, so a revoked session cannot query the database on every request. A lookup
 *   that reads "not authorized" (e.g. the fresh check after a code) also drops the number from this instance's list;
 * - fail closed: when the list cannot be loaded and the last copy is older than LIST_TTL_MS, only ALLOWED_PHONES
 *   is authorized (claimed names and approved requests are not).
 */
export const LIST_TTL_MS = 60_000;
export const RETRY_MS = 5_000;
/** Remembered misses are dropped when there are this many (only revoked or forged sessions miss). */
const MAX_MISSES = 1_000;

type AuthzState = {
  cache: { set: Set<string>; at: number } | null;
  lastAttempt: number;
  inflight: Promise<boolean> | null;
  misses: Map<string, number>;
};

/**
 * One state per server process, kept on globalThis: Next bundles route handlers and pages separately, so a module-level
 * variable would give the Telegram webhook (noteRevoked) and the board (isAuthorizedPhone) two different caches.
 */
const STATE_KEY = Symbol.for("orskh.authz");
const shared = globalThis as typeof globalThis & { [STATE_KEY]?: AuthzState };
const state: AuthzState = (shared[STATE_KEY] ??= { cache: null, lastAttempt: -Infinity, inflight: null, misses: new Map() });
const misses = state.misses;

/** Numbers of active claimed names and of approved requests, as one set. */
async function listed(): Promise<Set<string>> {
  const pool = await db();
  const [claimed, approved] = await Promise.all([activePhones(pool), approvedPhones(pool)]);
  for (const e of approved) claimed.add(e);
  return claimed;
}

function load(): Promise<boolean> {
  state.inflight ??= (async () => {
    state.lastAttempt = Date.now();
    try {
      state.cache = { set: await listed(), at: Date.now() };
      return true;
    } catch (e) {
      console.error("[authz] phone list unavailable:", (e as Error).message);
      return false;
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
}

function fresh(now: number): boolean {
  return state.cache !== null && now - state.cache.at < LIST_TTL_MS;
}

/**
 * Asks the database about one number; a hit joins the cached list, and a "no" read from the database leaves it (so a
 * removal seen by a fresh check also applies to this instance's later cached checks). A failed read authorizes nobody.
 */
async function lookUp(e: string, rememberMiss: boolean): Promise<boolean> {
  let ok = false;
  let read = false;
  try {
    const pool = await db();
    ok = (await holdsActiveName(pool, e)) || (await isApproved(pool, e));
    read = true;
  } catch (err) {
    console.error("[authz] phone check unavailable:", (err as Error).message);
  }
  if (ok) {
    misses.delete(e);
    state.cache?.set.add(e);
    return true;
  }
  if (read) state.cache?.set.delete(e);
  if (rememberMiss) {
    if (misses.size >= MAX_MISSES) misses.clear();
    misses.set(e, Date.now());
  }
  return false;
}

/**
 * True when the number may sign in. `fresh: true` reads the database now (used where a decision was just
 * made, e.g. right after a code check); a failed read then authorizes only ALLOWED_PHONES.
 */
export async function isAuthorizedPhone(phone: string, opts: { fresh?: boolean } = {}): Promise<boolean> {
  if (isAllowedPhone(phone)) return true;
  const e = normalizePhone(phone);
  if (!e) return false;
  if (opts.fresh) return lookUp(e, false);
  // Missing or expired list: load it, or wait for the load that is already running.
  if (!fresh(Date.now()) && (state.inflight || Date.now() - state.lastAttempt >= RETRY_MS)) await load();
  if (!fresh(Date.now())) return false;
  if (state.cache!.set.has(e)) return true;
  const missedAt = misses.get(e);
  if (missedAt !== undefined && Date.now() - missedAt < RETRY_MS) return false;
  return lookUp(e, true);
}

/**
 * True when the number holds a name right now: ALLOWED_PHONES, or a current claim of this number on an active user (read now,
 * never cached). For a browser holding an access cookie: was the number claimed (on another device) or given a name
 * since its code was checked? A failed read counts as not listed (the caller's own database read then reports the
 * outage).
 */
export async function isListedUser(phone: string): Promise<boolean> {
  if (isAllowedPhone(phone)) return true;
  const e = normalizePhone(phone);
  if (!e) return false;
  try {
    return await holdsActiveName(await db(), e);
  } catch (err) {
    console.error("[authz] claim check unavailable:", (err as Error).message);
    return false;
  }
}

/** This instance learns about an approval or a claim immediately (other instances find it on their next miss). */
export function noteAuthorized(phone: string): void {
  const e = normalizePhone(phone);
  if (!e) return;
  misses.delete(e);
  state.cache?.set.add(e);
}

/**
 * This instance forgets the number at once (an undone claim): its next check reads the database. Other instances
 * drop it with their next reload, within LIST_TTL_MS.
 */
export function noteRevoked(phone: string): void {
  const e = normalizePhone(phone);
  if (!e) return;
  misses.delete(e);
  state.cache?.set.delete(e);
}

/** Tests only: forget the cached list. */
export function resetAuthzCache(): void {
  state.cache = null;
  state.lastAttempt = -Infinity;
  state.inflight = null;
  misses.clear();
}
