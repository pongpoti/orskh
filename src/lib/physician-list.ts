import "server-only";
import type { Pool, PoolClient } from "pg";

type Q = Pool | PoolClient;

/**
 * The physician list: table `physicians` (db/schema.sql), one row per canonical mobile number (a second number is
 * another row with the same name). An active row authorizes the number (lib/authz.ts); the name and department label
 * the board and the sign-in alert, for inactive rows too. Edited in SQL or with scripts/sync-physicians.mjs, no redeploy.
 */

export interface Physician {
  name: string;
  /** Department or subspecialty in Thai, or null. */
  dept: string | null;
}

/** True when this one number has an active row (primary key lookup). */
export async function isActivePhysician(pool: Q, phone: string): Promise<boolean> {
  const { rowCount } = await pool.query("SELECT 1 FROM physicians WHERE phone = $1 AND active", [phone]);
  return rowCount === 1;
}

/** Every number with an active row (canonical when stored). */
export async function activePhysicianPhones(pool: Q): Promise<Set<string>> {
  const { rows } = await pool.query<{ phone: string }>("SELECT phone FROM physicians WHERE active");
  return new Set(rows.map((r) => r.phone));
}

/** Name and department for a canonical number (active or not), or null. Never throws: a failed read is logged. */
export async function physicianFor(pool: Q, phone: string): Promise<Physician | null> {
  try {
    const { rows } = await pool.query<{ name: string; dept: string | null }>(
      "SELECT name, dept FROM physicians WHERE phone = $1",
      [phone],
    );
    if (!rows.length) return null;
    const dept = rows[0].dept?.trim();
    return { name: rows[0].name.trim(), dept: dept ? dept : null };
  } catch (e) {
    console.error("[physicians] lookup failed:", (e as Error).message);
    return null;
  }
}
