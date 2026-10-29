import "server-only";
import { approvedRequest } from "../access";
import { db } from "../db";
import { normalizePhone } from "../phone";
import { roleLabel, TYPE_LABELS } from "../user-labels";
import { fullName, userForPhone } from "../user-list";

/** Shown when nothing better is known (no claimed name, no approved request, no LINE display name). */
export const FALLBACK_NAME = "ผู้ใช้ LINE";

export interface Profile {
  /** "ชื่อ นามสกุล" for the top bar and the account menu. */
  name: string;
  /** "แพทย์ · ออร์โธปิดิกส์" (claimed name) or "พยาบาล" (approved request); null for a LINE name. */
  role: string | null;
}

/**
 * Who the board shows for a signed-in user, resolved on every request (a corrected name shows without signing out):
 * the active user whose current claim holds the number (first and last name, type and subtype from users), else the approved access
 * request's "first last" and position, else the LINE display name, else FALLBACK_NAME. Never throws: a database
 * problem falls back to the LINE name (logged).
 */
export async function profileFor(phone: string, lineName: string): Promise<Profile> {
  const line = { name: lineName.trim() || FALLBACK_NAME, role: null };
  const e = normalizePhone(phone);
  if (!e) return line;
  try {
    const pool = await db();
    const user = await userForPhone(pool, e);
    if (user) return { name: fullName(user), role: roleLabel(user.type, user.subtype) };
    const request = await approvedRequest(pool, e);
    if (request) return { name: `${request.firstName} ${request.lastName}`, role: TYPE_LABELS[request.position] ?? null };
  } catch (err) {
    console.error("[auth] display name lookup failed:", (err as Error).message);
  }
  return line;
}

/** The name alone (see profileFor()). */
export async function displayNameFor(phone: string, lineName: string): Promise<string> {
  return (await profileFor(phone, lineName)).name;
}
