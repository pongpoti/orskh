import "server-only";
import type { Pool, PoolClient } from "pg";
import { withTx } from "./db";
import { isUserType, TYPE_LABELS, type UserType } from "./user-labels";

type Q = Pool | PoolClient;

/**
 * Access requests: a LINE account that verified a mobile number which holds no name (someone not on the users list, or
 * whose name was claimed by someone else) asks for access; an administrator approves or rejects it in Telegram
 * (lib/telegram-webhook.ts). A number with an approved request is authorized like a claimed name (lib/authz.ts).
 */

/** The four user types (lib/user-labels.ts), with their Thai labels. */
export const POSITIONS: Record<UserType, string> = TYPE_LABELS;
export type Position = UserType;
export type RequestStatus = "pending" | "approved" | "rejected";

export const NAME_MAX = 60;
export const REQUEST_LIMITS = { perSubDay: 3 } as const;
/** After a rejection the same number cannot ask again for this long. */
export const REREQUEST_BLOCK_MS = 24 * 3600 * 1000;

// Letters (any script, with their combining marks, e.g. Thai vowels and tone marks), spaces and . - '
// Anything else (digits, symbols, emoji, control, zero-width and bidi characters) is refused.
const NAME_RE = /^(?:\p{L}\p{M}*|[ .'-])+$/u;

/** NFC + trim + single spaces. Returns null unless 1-60 characters of letters, spaces and . - ' remain. */
export function cleanPersonName(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 200) return null;
  const v = input.normalize("NFC").trim().replace(/ {2,}/g, " ");
  const len = Array.from(v).length;
  if (len < 1 || len > NAME_MAX || !NAME_RE.test(v) || !/\p{L}/u.test(v)) return null;
  return v;
}

export function parsePosition(input: unknown): Position | null {
  return isUserType(input) ? input : null;
}

export interface TelegramRef {
  chat_id: string;
  message_id: number;
}

export interface AccessRequest {
  id: string;
  phone: string;
  lineSub: string;
  lineName: string | null;
  firstName: string;
  lastName: string;
  position: Position;
  status: RequestStatus;
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  tgMessages: TelegramRef[];
}

interface Row {
  id: string;
  phone: string;
  line_sub: string;
  line_name: string | null;
  first_name: string;
  last_name: string;
  position: Position;
  status: RequestStatus;
  created_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  tg_messages: unknown;
}

const COLUMNS =
  "id, phone, line_sub, line_name, first_name, last_name, position, status, created_at, decided_at, decided_by, tg_messages";

function refs(v: unknown): TelegramRef[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (r): r is TelegramRef =>
      !!r && typeof r === "object" && typeof r.chat_id === "string" && Number.isSafeInteger(r.message_id),
  );
}

function toRequest(r: Row): AccessRequest {
  return {
    id: String(r.id),
    phone: r.phone,
    lineSub: r.line_sub,
    lineName: r.line_name,
    firstName: r.first_name,
    lastName: r.last_name,
    position: r.position,
    status: r.status,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by === null ? null : String(r.decided_by),
    tgMessages: refs(r.tg_messages),
  };
}

/** What /login/request shows for the latest request of a number, seen from one LINE account. */
export type RequestView = "form" | "pending" | "approved" | "rejected" | "signin";

/**
 * - pending: waiting for a decision
 * - approved: approved for this LINE account (it may sign in from the waiting page)
 * - signin: approved, but requested from another LINE account: sign in again with LINE + code
 * - rejected: rejected less than 24 h ago (no new request yet)
 * - form: nothing pending (none yet, or rejected long enough ago)
 */
export function viewFor(row: AccessRequest | null, sub: string, now = Date.now()): RequestView {
  if (!row) return "form";
  if (row.status === "pending") return "pending";
  if (row.status === "approved") return row.lineSub === sub ? "approved" : "signin";
  const at = (row.decidedAt ?? row.createdAt).getTime();
  return now - at < REREQUEST_BLOCK_MS ? "rejected" : "form";
}

export async function latestRequest(pool: Q, phone: string): Promise<AccessRequest | null> {
  const { rows } = await pool.query<Row>(
    `SELECT ${COLUMNS} FROM access_requests WHERE phone = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [phone],
  );
  return rows.length ? toRequest(rows[0]) : null;
}

export async function getRequest(pool: Q, id: string): Promise<AccessRequest | null> {
  const { rows } = await pool.query<Row>(`SELECT ${COLUMNS} FROM access_requests WHERE id = $1`, [id]);
  return rows.length ? toRequest(rows[0]) : null;
}

/** Latest approved request of a number (optionally made from one LINE account), or null. */
export async function approvedRequest(pool: Q, phone: string, sub?: string): Promise<AccessRequest | null> {
  const { rows } = await pool.query<Row>(
    `SELECT ${COLUMNS} FROM access_requests
     WHERE phone = $1 AND status = 'approved' AND ($2::text IS NULL OR line_sub = $2)
     ORDER BY decided_at DESC NULLS LAST, id DESC LIMIT 1`,
    [phone, sub ?? null],
  );
  return rows.length ? toRequest(rows[0]) : null;
}

/** True when this one number has an approved request (uses access_requests_approved_idx). */
export async function isApproved(pool: Q, phone: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "SELECT 1 FROM access_requests WHERE phone = $1 AND status = 'approved' LIMIT 1",
    [phone],
  );
  return rowCount === 1;
}

/** Every number with an approved request (canonical when stored). */
export async function approvedPhones(pool: Q): Promise<Set<string>> {
  const { rows } = await pool.query<{ phone: string }>(
    "SELECT DISTINCT phone FROM access_requests WHERE status = 'approved'",
  );
  return new Set(rows.map((r) => r.phone));
}

export type CreateResult =
  | { status: "created"; request: AccessRequest }
  | { status: "exists"; view: Exclude<RequestView, "form"> }
  | { status: "limited"; retryAfterS: number };

/**
 * Stores a new pending request unless one is pending (one per number, also enforced by a partial unique
 * index), the number was approved, it was rejected less than 24 h ago, the number holds an active name on the users
 * list (it signs in with that: "signin"), or this LINE account already sent REQUEST_LIMITS.perSubDay requests in the
 * last 24 h. lib/user-list.ts claimUser() takes the same 'access-phone:' lock, so a claim and a request of one number
 * never both go through.
 */
export async function createRequest(
  pool: Pool,
  r: { phone: string; sub: string; lineName: string; firstName: string; lastName: string; position: Position; ip: string },
): Promise<CreateResult> {
  try {
    return await withTx(pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('access-sub:' || $1))", [r.sub]);
      await c.query("SELECT pg_advisory_xact_lock(hashtext('access-phone:' || $1))", [r.phone]);
      const view = viewFor(await latestRequest(c, r.phone), r.sub);
      if (view !== "form") return { status: "exists", view };
      const held = await c.query(
        `SELECT 1 FROM user_claims cl JOIN users u ON u.id = cl.user_id
         WHERE cl.phone = $1 AND cl.undone_at IS NULL AND u.active`,
        [r.phone],
      );
      if (held.rowCount) return { status: "exists", view: "signin" };
      const { rows } = await c.query<{ n: number; oldest_s: number | null }>(
        `SELECT count(*)::int AS n, extract(epoch FROM now() - min(created_at))::float8 AS oldest_s
         FROM access_requests WHERE line_sub = $1 AND created_at > now() - interval '24 hours'`,
        [r.sub],
      );
      if (rows[0].n >= REQUEST_LIMITS.perSubDay) {
        return { status: "limited", retryAfterS: Math.max(60, Math.ceil(24 * 3600 - (rows[0].oldest_s ?? 0))) };
      }
      const ins = await c.query<Row>(
        `INSERT INTO access_requests (phone, line_sub, line_name, first_name, last_name, position, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
        [r.phone, r.sub, r.lineName.slice(0, 200) || null, r.firstName, r.lastName, r.position, r.ip],
      );
      return { status: "created", request: toRequest(ins.rows[0]) };
    });
  } catch (e) {
    // A concurrent request for the same number won the race (partial unique index).
    if ((e as { code?: string }).code === "23505") return { status: "exists", view: "pending" };
    throw e;
  }
}

/** Remembers which Telegram messages show this request (they are edited after the decision). */
export async function saveTelegramRefs(pool: Q, id: string, sent: TelegramRef[]): Promise<void> {
  await pool.query("UPDATE access_requests SET tg_messages = tg_messages || $2::jsonb WHERE id = $1", [
    id,
    JSON.stringify(sent),
  ]);
}

export type DecideResult =
  | { outcome: "decided"; request: AccessRequest }
  | { outcome: "already"; request: AccessRequest }
  | { outcome: "missing" };

/** Atomic: only a pending request changes, so two taps (or two admins) can never both decide. */
export async function decideRequest(
  pool: Q,
  id: string,
  decision: "approved" | "rejected",
  decidedBy: string,
): Promise<DecideResult> {
  const { rows } = await pool.query<Row>(
    `UPDATE access_requests SET status = $2, decided_at = now(), decided_by = $3
     WHERE id = $1 AND status = 'pending' RETURNING ${COLUMNS}`,
    [id, decision, decidedBy],
  );
  if (rows.length) return { outcome: "decided", request: toRequest(rows[0]) };
  const current = await getRequest(pool, id);
  return current ? { outcome: "already", request: current } : { outcome: "missing" };
}
