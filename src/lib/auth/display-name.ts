import "server-only";
import { approvedRequest } from "../access";
import { db } from "../db";
import { normalizeEmail } from "../email";
import { physicianFor } from "../physician-list";

/** Shown when nothing better is known (no table row, no approved request, no LINE display name). */
export const FALLBACK_NAME = "ผู้ใช้ LINE";

/**
 * The name the board shows for a signed-in user, resolved on every request (a corrected name shows without signing
 * out): the physicians row of the email (active or not), else the approved access request's "first last", else the
 * LINE display name, else FALLBACK_NAME. Never throws: a database problem falls back to the LINE name (logged).
 */
export async function displayNameFor(email: string, lineName: string): Promise<string> {
  const line = lineName.trim() || FALLBACK_NAME;
  const e = normalizeEmail(email);
  if (!e) return line;
  try {
    const pool = await db();
    const physician = await physicianFor(pool, e);
    if (physician?.name) return physician.name;
    const request = await approvedRequest(pool, e);
    if (request) return `${request.firstName} ${request.lastName}`;
  } catch (err) {
    console.error("[auth] display name lookup failed:", (err as Error).message);
  }
  return line;
}
