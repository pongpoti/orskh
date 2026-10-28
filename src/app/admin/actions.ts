"use server";

import { isAdmin } from "@/lib/admin";
import { getUser } from "@/lib/auth/server";
import { addSurgeon, deleteSurgeon, listSurgeons, updateSurgeon } from "@/lib/surgeon-store";
import { checkSurgeon, isSurgeonId, type Surgeon } from "@/lib/surgeons";

/** Every answer carries the list as it now stands, so the page also picks up another admin's changes. */
export type AdminResult = { ok: true; list: Surgeon[]; message: string } | { ok: false; error: string; list?: Surgeon[] };

const NOT_ADMIN: AdminResult = { ok: false, error: "เฉพาะผู้ดูแลระบบเท่านั้น ลองออกจากระบบแล้วเข้าใหม่" };
const FAILED: AdminResult = { ok: false, error: "บันทึกไม่สำเร็จ ลองอีกครั้ง" };

/** Server actions can be called by anyone who can reach the site, so each one checks the admin again. */
async function signedInAdmin(): Promise<boolean> {
  // getUser() re-checks the signed session and that the email is still authorized; admins are listed by LINE user id.
  const user = await getUser();
  return isAdmin(user?.sub);
}

/** Adds a surgeon (`id` null) or edits one. */
export async function saveSurgeon(input: { id: number | null; name: string; specialty: string }): Promise<AdminResult> {
  if (!(await signedInAdmin())) return NOT_ADMIN;
  const checked = checkSurgeon(input?.name, input?.specialty);
  if (!checked.ok) return { ok: false, error: checked.error };
  const id = input?.id ?? null;
  if (id !== null && !isSurgeonId(id)) return FAILED;

  try {
    const values = { name: checked.name, specialty: checked.specialty };
    const result = id === null ? await addSurgeon(values) : await updateSurgeon(id, values);
    if (!result.ok) {
      const error = result.reason === "duplicate" ? "มีชื่อนี้ในรายชื่อแล้ว" : "ไม่พบรายชื่อนี้แล้ว อาจถูกลบไปก่อนหน้า";
      return { ok: false, error, list: await listSurgeons() };
    }
    return { ok: true, list: await listSurgeons(), message: id === null ? `เพิ่ม ${checked.name} แล้ว` : `บันทึกการแก้ไข ${checked.name} แล้ว` };
  } catch (error) {
    console.error("Saving a surgeon failed", error);
    return FAILED;
  }
}

export async function removeSurgeon(id: number): Promise<AdminResult> {
  if (!(await signedInAdmin())) return NOT_ADMIN;
  if (!isSurgeonId(id)) return FAILED;

  try {
    const removed = await deleteSurgeon(id);
    const list = await listSurgeons();
    return removed ? { ok: true, list, message: `ลบ ${removed.name} แล้ว` } : { ok: true, list, message: "รายชื่อนี้ถูกลบไปแล้ว" };
  } catch (error) {
    console.error("Deleting a surgeon failed", error);
    return { ok: false, error: "ลบไม่สำเร็จ ลองอีกครั้ง" };
  }
}
