import "server-only";
import type { Pool, PoolClient } from "pg";
import { latestRequest, viewFor, type TelegramRef } from "./access";
import { withTx } from "./db";
import { upsertBinding } from "./otp";
import type { UserType } from "./user-labels";

type Q = Pool | PoolClient;

/**
 * The list of people who may claim their name: table `users` (db/schema.sql), shared with the rest of the project and
 * loaded with scripts/sync-users.mjs (names, type and subtype, no numbers). The sign-in only reads it. After the SMS
 * code, someone whose number is not authorized claims their own name on /login/claim: the first claim wins and is
 * stored in `user_claims` with the verified number and LINE account. A user's current claim is their user_claims row
 * with undone_at IS NULL; it authorizes its number while the user is active (lib/authz.ts) and names it on the board and
 * in alerts. Every claim is announced in Telegram with an undo button (lib/telegram-webhook.ts).
 */

export const CLAIM_LIMITS = {
  /** Claim attempts (won or lost) per LINE account per 24 h. */
  perSubDay: 5,
  /** Claim attempts per number per 24 h. */
  perPhoneDay: 5,
} as const;
/** After an administrator's undo, that number (and that LINE account) cannot claim again for this long. */
export const UNDO_BLOCK_MS = 24 * 3600 * 1000;

/** Why a claim ended: the Telegram undo button, closed by a new claim while its user was inactive, or by hand in SQL. */
export type UndoReason = "admin" | "inactive" | "manual";

export interface ListedUser {
  id: string;
  firstName: string;
  lastName: string;
  type: UserType;
  subtype: string | null;
}

/** One name on the claim page. No number and no LINE id: only whether the name is taken. */
export interface ClaimableName {
  id: string;
  first_name: string;
  last_name: string;
  subtype: string | null;
  claimed: boolean;
}

export interface UserClaim {
  id: string;
  userId: string;
  phone: string;
  lineSub: string;
  lineName: string | null;
  createdAt: Date;
  undoneAt: Date | null;
  undoneBy: string | null;
  undoReason: UndoReason | null;
  tgMessages: TelegramRef[];
}

interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  type: UserType;
  subtype: string | null;
}

interface ClaimRow {
  id: string;
  user_id: string;
  phone: string;
  line_sub: string;
  line_name: string | null;
  created_at: Date;
  undone_at: Date | null;
  undone_by: string | null;
  undo_reason: UndoReason | null;
  tg_messages: unknown;
}

const USER_COLUMNS = "u.id::text AS id, u.first_name, u.last_name, u.type, u.subtype";
const CLAIM_COLUMNS =
  "id::text AS id, user_id::text AS user_id, phone, line_sub, line_name, created_at, undone_at, undone_by::text AS undone_by, " +
  "undo_reason, tg_messages";

/** Unique indexes of user_claims (db/schema.sql): one current claim per user, per number, per LINE account. */
const CURRENT_USER_KEY = "user_claims_current_user_key";
const CURRENT_PHONE_KEY = "user_claims_current_phone_key";
const CURRENT_LINE_SUB_KEY = "user_claims_current_line_sub_key";

function toUser(r: UserRow): ListedUser {
  return { id: r.id, firstName: r.first_name, lastName: r.last_name, type: r.type, subtype: r.subtype };
}

function refs(v: unknown): TelegramRef[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (r): r is TelegramRef =>
      !!r && typeof r === "object" && typeof r.chat_id === "string" && Number.isSafeInteger(r.message_id),
  );
}

function toClaim(r: ClaimRow): UserClaim {
  return {
    id: r.id,
    userId: r.user_id,
    phone: r.phone,
    lineSub: r.line_sub,
    lineName: r.line_name,
    createdAt: r.created_at,
    undoneAt: r.undone_at,
    undoneBy: r.undone_by,
    undoReason: r.undo_reason,
    tgMessages: refs(r.tg_messages),
  };
}

/** "สมชาย ใจดี". */
export function fullName(s: { firstName: string; lastName: string }): string {
  return `${s.firstName} ${s.lastName}`;
}

/** The active names of one type, in Thai order, each with whether it is taken. Nothing else leaves the tables. */
export async function listClaimable(pool: Q, type: UserType): Promise<ClaimableName[]> {
  const { rows } = await pool.query<ClaimableName>(
    `SELECT u.id::text AS id, u.first_name, u.last_name, u.subtype,
            EXISTS (SELECT 1 FROM user_claims c WHERE c.user_id = u.id AND c.undone_at IS NULL) AS claimed
     FROM users u WHERE u.active AND u.type = $1`,
    [type],
  );
  return rows
    .map((r) => ({ id: r.id, first_name: r.first_name, last_name: r.last_name, subtype: r.subtype, claimed: r.claimed }))
    .sort((a, b) => a.first_name.localeCompare(b.first_name, "th") || a.last_name.localeCompare(b.last_name, "th"));
}

/** The active user whose current claim holds this number, or null. */
export async function userForPhone(pool: Q, phone: string): Promise<ListedUser | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM user_claims c JOIN users u ON u.id = c.user_id
     WHERE c.phone = $1 AND c.undone_at IS NULL AND u.active`,
    [phone],
  );
  return rows.length ? toUser(rows[0]) : null;
}

/** True when this number holds a current claim on an active user (unique index lookup). */
export async function holdsActiveName(pool: Q, phone: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM user_claims c JOIN users u ON u.id = c.user_id
     WHERE c.phone = $1 AND c.undone_at IS NULL AND u.active`,
    [phone],
  );
  return rowCount === 1;
}

/** Every number with a current claim on an active user. */
export async function activePhones(pool: Q): Promise<Set<string>> {
  const { rows } = await pool.query<{ phone: string }>(
    "SELECT c.phone FROM user_claims c JOIN users u ON u.id = c.user_id WHERE c.undone_at IS NULL AND u.active",
  );
  return new Set(rows.map((r) => r.phone));
}

/**
 * True when an administrator undid a claim of this number, or by this LINE account, less than 24 h ago. Only
 * undo_reason 'admin' counts: a claim the app closed ('inactive') or one released by hand ('manual') never blocks.
 */
export async function claimBlocked(pool: Q, phone: string, sub: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM user_claims
     WHERE (phone = $1 OR line_sub = $2) AND undo_reason = 'admin' AND undone_at > now() - make_interval(secs => $3) LIMIT 1`,
    [phone, sub, UNDO_BLOCK_MS / 1000],
  );
  return rowCount === 1;
}

export async function getClaim(pool: Q, id: string): Promise<UserClaim | null> {
  const { rows } = await pool.query<ClaimRow>(`SELECT ${CLAIM_COLUMNS} FROM user_claims WHERE id = $1`, [id]);
  return rows.length ? toClaim(rows[0]) : null;
}

export async function getListedUser(pool: Q, id: string): Promise<ListedUser | null> {
  const { rows } = await pool.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
  return rows.length ? toUser(rows[0]) : null;
}

export type ClaimResult =
  | { status: "claimed"; claim: UserClaim; user: ListedUser }
  /** This number already holds this very name (a second tab, or a retry after the answer was lost). */
  | { status: "own_claim"; user: ListedUser }
  /** Someone else claimed the name first. */
  | { status: "taken" }
  /** No such name, or it is no longer active. */
  | { status: "unavailable" }
  /** This number already holds another (active) name. */
  | { status: "phone_has_claim" }
  /** This LINE account already holds another (active) name, through another number. */
  | { status: "line_has_claim" }
  /** The number has an access request (pending, approved, or rejected less than 24 h ago): it goes to that instead. */
  | { status: "requested" }
  /** An administrator undid a claim of this number or LINE account less than 24 h ago. */
  | { status: "blocked" }
  | { status: "limited"; retryAfterS: number };

const DAY_S = 24 * 3600;

/**
 * Claims one name for a verified number, atomically: one INSERT INTO user_claims that reads the user in the same
 * statement (it must exist and be active) and is guarded by the partial unique indexes (one current claim per user,
 * per number, per LINE account), so of two people claiming the same name the first wins and the second gets "taken".
 * One LINE account, one number, one name. In the same transaction the LINE account is bound to the number
 * (line_bindings, so nothing between the claim and the sign-in can fail on its own) and the attempt is logged in
 * login_events ('claim' or 'claim_failed'). Refused before any attempt: a number or LINE account whose claim an
 * administrator undid less than 24 h ago, a number with an access request (claims and requests exclude each other:
 * both take the 'access-phone:' lock), and more than CLAIM_LIMITS attempts in 24 h. Attempts of one LINE account and of
 * one number are serialized by advisory locks, so double taps cannot get round the limits. `users` is only read.
 *
 * A current claim of this number or LINE account on a user that is no longer active (e.g. a name whose spelling was
 * corrected in the CSV) is closed first (undo_reason 'inactive', no 24 h block), so the person can claim the corrected
 * name. A failed attempt leaves it as it was (savepoint).
 */
export async function claimUser(
  pool: Pool,
  r: { userId: string; phone: string; sub: string; lineName: string; ip: string; userAgent: string },
): Promise<ClaimResult> {
  return withTx(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('claim-sub:' || $1))", [r.sub]);
    await c.query("SELECT pg_advisory_xact_lock(hashtext('claim-phone:' || $1))", [r.phone]);
    // the lock createRequest() takes: a claim and a request of one number never both go through
    await c.query("SELECT pg_advisory_xact_lock(hashtext('access-phone:' || $1))", [r.phone]);
    if (await claimBlocked(c, r.phone, r.sub)) return { status: "blocked" };
    if (viewFor(await latestRequest(c, r.phone), r.sub) !== "form") return { status: "requested" };
    const { rows: counts } = await c.query<{ sub_n: number; sub_oldest_s: number | null; phone_n: number; phone_oldest_s: number | null }>(
      `SELECT
         count(*) FILTER (WHERE line_sub = $2)::int AS sub_n,
         extract(epoch FROM now() - min(at) FILTER (WHERE line_sub = $2))::float8 AS sub_oldest_s,
         count(*) FILTER (WHERE phone = $1)::int AS phone_n,
         extract(epoch FROM now() - min(at) FILTER (WHERE phone = $1))::float8 AS phone_oldest_s
       FROM login_events
       WHERE event IN ('claim', 'claim_failed') AND at > now() - interval '24 hours' AND (line_sub = $2 OR phone = $1)`,
      [r.phone, r.sub],
    );
    const n = counts[0];
    const wait = (oldest: number | null) => Math.max(60, Math.ceil(DAY_S - (oldest ?? 0)));
    if (n.sub_n >= CLAIM_LIMITS.perSubDay) return { status: "limited", retryAfterS: wait(n.sub_oldest_s) };
    if (n.phone_n >= CLAIM_LIMITS.perPhoneDay) return { status: "limited", retryAfterS: wait(n.phone_oldest_s) };

    const event = (name: "claim" | "claim_failed") =>
      c.query("INSERT INTO login_events (line_sub, phone, event, ip, user_agent) VALUES ($1, $2, $3, $4, $5)", [
        r.sub,
        r.phone,
        name,
        r.ip,
        r.userAgent,
      ]);

    // already this number's (active) name: no new claim, no attempt counted (the caller finishes the sign-in)
    const { rows: own } = await c.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM user_claims c JOIN users u ON u.id = c.user_id
       WHERE c.user_id = $1 AND c.phone = $2 AND c.undone_at IS NULL AND u.active`,
      [r.userId, r.phone],
    );
    if (own.length) {
      await upsertBinding(c, r.sub, r.phone, r.lineName);
      return { status: "own_claim", user: toUser(own[0]) };
    }

    await c.query("SAVEPOINT claim_attempt");
    let claim: ClaimRow | undefined;
    try {
      // current claims of this number or LINE account on inactive users end (kept only if the claim below fails)
      await c.query(
        `UPDATE user_claims c SET undone_at = now(), undone_by = NULL, undo_reason = 'inactive'
         WHERE c.undone_at IS NULL AND (c.phone = $1 OR c.line_sub = $2)
           AND EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id AND NOT u.active)`,
        [r.phone, r.sub],
      );
      const ins = await c.query<ClaimRow>(
        `INSERT INTO user_claims (user_id, phone, line_sub, line_name, ip)
         SELECT u.id, $2, $3, $4, $5 FROM users u WHERE u.id = $1 AND u.active
         RETURNING ${CLAIM_COLUMNS}`,
        [r.userId, r.phone, r.sub, r.lineName.slice(0, 200) || null, r.ip],
      );
      claim = ins.rows[0];
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      if (err.code !== "23505") throw e;
      await c.query("ROLLBACK TO SAVEPOINT claim_attempt");
      await event("claim_failed");
      // The indexes are checked in the order they were created (user, number, LINE account), so a name someone else
      // holds reads "taken" even when this number or LINE account also holds a name.
      if (err.constraint === CURRENT_USER_KEY) return { status: "taken" };
      if (err.constraint === CURRENT_LINE_SUB_KEY) return { status: "line_has_claim" };
      if (err.constraint === CURRENT_PHONE_KEY) return { status: "phone_has_claim" };
      throw e;
    }
    if (!claim) {
      await c.query("ROLLBACK TO SAVEPOINT claim_attempt");
      await event("claim_failed");
      return { status: "unavailable" };
    }
    await c.query("RELEASE SAVEPOINT claim_attempt");
    const user = await getListedUser(c, claim.user_id);
    await upsertBinding(c, r.sub, r.phone, r.lineName);
    await event("claim");
    return { status: "claimed", claim: toClaim(claim), user: user! };
  });
}

/** Remembers which Telegram messages announced this claim (they are edited after an undo). */
export async function saveClaimTelegramRefs(pool: Q, id: string, sent: TelegramRef[]): Promise<void> {
  await pool.query("UPDATE user_claims SET tg_messages = tg_messages || $2::jsonb WHERE id = $1", [id, JSON.stringify(sent)]);
}

export type UndoResult =
  | { outcome: "undone"; claim: UserClaim; user: ListedUser }
  /** Ended before (a second tap, another admin, a release by hand, or a newer claim of the same person). */
  | { outcome: "already"; claim: UserClaim }
  | { outcome: "missing" };

/**
 * An administrator's undo of one claim: one conditional UPDATE (only while the claim is current), so two taps (or two
 * admins) can never both undo, and an old message can never end a newer claim. The claim is marked undone by that
 * Telegram id with undo_reason 'admin' (which blocks the number and LINE account from claiming for 24 h), the name is
 * free again, and the LINE bindings of that number are deleted (signing in again needs LINE and an SMS code). `users`
 * is only read. The caller drops the number from the authorization cache.
 */
export async function undoClaim(pool: Pool, claimId: string, by: string): Promise<UndoResult> {
  return withTx(pool, async (c) => {
    const { rows } = await c.query<ClaimRow>(
      `UPDATE user_claims SET undone_at = now(), undone_by = $2, undo_reason = 'admin'
       WHERE id = $1 AND undone_at IS NULL
       RETURNING ${CLAIM_COLUMNS}`,
      [claimId, by],
    );
    if (!rows.length) {
      const current = await getClaim(c, claimId);
      return current ? { outcome: "already", claim: current } : { outcome: "missing" };
    }
    const claim = toClaim(rows[0]);
    await c.query("DELETE FROM line_bindings WHERE phone = $1", [claim.phone]);
    const user = await getListedUser(c, claim.userId);
    return { outcome: "undone", claim, user: user! };
  });
}
