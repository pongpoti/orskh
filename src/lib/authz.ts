import "server-only";
import { approvedEmails, isApproved } from "./access";
import { db } from "./db";
import { isAllowedEmail, normalizeEmail } from "./email";
import { activePhysicianEmails, isActivePhysician } from "./physician-list";

/**
 * Who may open the board: an email with an active row in the `physicians` table OR an approved access request, or
 * one in the optional break-glass ALLOWED_EMAILS (env, never needs the database). The database part is one list
 * (active physicians + approved requests), cached per server instance:
 * - the list is reloaded at least every LIST_TTL_MS, so a removal (active = false) or a revoked request applies
 *   within that time; callers that arrive while a reload runs wait for it (never answered from a missing or
 *   expired list);
 * - an email missing from a current list is looked up on its own (two indexed queries): it may have been added or
 *   approved since, possibly on another instance (on Vercel the proxy never sees the webhook's noteApproved()).
 *   A miss is remembered for RETRY_MS, so a revoked session cannot query the database on every request. A lookup
 *   that reads "not authorized" (e.g. the fresh check after a code) also drops the email from this instance's list;
 * - fail closed: when the list cannot be loaded and the last copy is older than LIST_TTL_MS, only ALLOWED_EMAILS
 *   is authorized (physicians and approved requests are not).
 */
export const LIST_TTL_MS = 60_000;
export const RETRY_MS = 5_000;
/** Remembered misses are dropped when there are this many (only revoked or forged-email sessions miss). */
const MAX_MISSES = 1_000;

let cache: { set: Set<string>; at: number } | null = null;
let lastAttempt = -Infinity;
let inflight: Promise<boolean> | null = null;
const misses = new Map<string, number>();

/** Active physicians and approved requests, as one set. */
async function listed(): Promise<Set<string>> {
  const pool = await db();
  const [physicians, approved] = await Promise.all([activePhysicianEmails(pool), approvedEmails(pool)]);
  for (const e of approved) physicians.add(e);
  return physicians;
}

function load(): Promise<boolean> {
  inflight ??= (async () => {
    lastAttempt = Date.now();
    try {
      cache = { set: await listed(), at: Date.now() };
      return true;
    } catch (e) {
      console.error("[authz] email list unavailable:", (e as Error).message);
      return false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function fresh(now: number): boolean {
  return cache !== null && now - cache.at < LIST_TTL_MS;
}

/**
 * Asks the database about one email; a hit joins the cached list, and a "no" read from the database leaves it (so a
 * removal seen by a fresh check also applies to this instance's later cached checks). A failed read authorizes nobody.
 */
async function lookUp(e: string, rememberMiss: boolean): Promise<boolean> {
  let ok = false;
  let read = false;
  try {
    const pool = await db();
    ok = (await isActivePhysician(pool, e)) || (await isApproved(pool, e));
    read = true;
  } catch (err) {
    console.error("[authz] email check unavailable:", (err as Error).message);
  }
  if (ok) {
    misses.delete(e);
    cache?.set.add(e);
    return true;
  }
  if (read) cache?.set.delete(e);
  if (rememberMiss) {
    if (misses.size >= MAX_MISSES) misses.clear();
    misses.set(e, Date.now());
  }
  return false;
}

/**
 * True when the email may sign in. `fresh: true` reads the database now (used where a decision was just
 * made, e.g. right after a code check); a failed read then authorizes only ALLOWED_EMAILS.
 */
export async function isAuthorizedEmail(email: string, opts: { fresh?: boolean } = {}): Promise<boolean> {
  if (isAllowedEmail(email)) return true;
  const e = normalizeEmail(email);
  if (!e) return false;
  if (opts.fresh) return lookUp(e, false);
  // Missing or expired list: load it, or wait for the load that is already running.
  if (!fresh(Date.now()) && (inflight || Date.now() - lastAttempt >= RETRY_MS)) await load();
  if (!fresh(Date.now())) return false;
  if (cache!.set.has(e)) return true;
  const missedAt = misses.get(e);
  if (missedAt !== undefined && Date.now() - missedAt < RETRY_MS) return false;
  return lookUp(e, true);
}

/**
 * True when the email is on the physician list right now: ALLOWED_EMAILS, or an active physicians row (read now,
 * never cached). For a browser holding an access cookie: was the address added since its code was checked? A failed
 * read counts as not listed (the caller's own database read then reports the outage).
 */
export async function isListedPhysician(email: string): Promise<boolean> {
  if (isAllowedEmail(email)) return true;
  const e = normalizeEmail(email);
  if (!e) return false;
  try {
    return await isActivePhysician(await db(), e);
  } catch (err) {
    console.error("[authz] physician check unavailable:", (err as Error).message);
    return false;
  }
}

/** This instance learns about an approval immediately (other instances find it on their next miss). */
export function noteApproved(email: string): void {
  const e = normalizeEmail(email);
  if (!e) return;
  misses.delete(e);
  cache?.set.add(e);
}

/** Tests only: forget the cached list. */
export function resetAuthzCache(): void {
  cache = null;
  lastAttempt = -Infinity;
  inflight = null;
  misses.clear();
}
