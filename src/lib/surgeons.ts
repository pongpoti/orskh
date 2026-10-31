import { isSpecialtyCode, type SpecialtyCode } from "./specialties.ts";

/** A surgeon in the admin list. The specialty is a department code; rows edited by hand may hold one the app no longer lists. */
export type Surgeon = { id: number; name: string; specialty: string };

export const NAME_MAX_LENGTH = 120;

/**
 * Thai names are typed with uneven spacing and, when pasted, often carry invisible format characters (zero-width
 * spaces, direction marks, soft hyphens). Those are dropped and spaces evened out, then the result is put in NFC
 * last, because a dropped character can leave marks next to each other that NFC has to reorder.
 */
export function normaliseName(name: string): string {
  return name
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
}

/** By specialty code from A to Z, then by name in Thai alphabetical order. */
export function sortSurgeons<T extends { name: string; specialty: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => compareCodes(a.specialty, b.specialty) || a.name.localeCompare(b.name, "th"));
}

/** Plain character order, so the codes sort the same on every machine whatever its locale. */
function compareCodes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The form's name and specialty, cleaned, or the reason they cannot be saved. Anything may arrive here, so nothing is assumed. */
export function checkSurgeon(
  name: unknown,
  specialty: unknown,
): { ok: true; name: string; specialty: SpecialtyCode } | { ok: false; error: string } {
  const clean = typeof name === "string" ? normaliseName(name) : "";
  if (!clean) return { ok: false, error: "กรุณากรอกชื่อ-นามสกุล" };
  if (clean.length > NAME_MAX_LENGTH) return { ok: false, error: `ชื่อยาวได้ไม่เกิน ${NAME_MAX_LENGTH} ตัวอักษร` };
  if (typeof specialty !== "string" || !isSpecialtyCode(specialty)) return { ok: false, error: "กรุณาเลือกสาขา" };
  return { ok: true, name: clean, specialty };
}

/** A database row id sent back from the page: a positive whole number. */
export function isSurgeonId(id: unknown): id is number {
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}
