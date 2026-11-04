"use server";

import { revalidatePath } from "next/cache";
import { checkCase, type AddedCase } from "@/lib/added-cases";
import { getUser } from "@/lib/auth/server";
import { addedToday, DAILY_ADD_LIMIT, doctorFor, insertCase, listCasesBy, removeCase } from "@/lib/cases";
import { db } from "@/lib/db";
import { thaiDate, todayIso } from "@/lib/days";
import { holidayOn } from "@/lib/holidays";
import { getRoom, roomLabel } from "@/lib/rooms";

/** Every answer carries the doctor's own cases from today on, so the form's list stays current. */
export type CaseResult = { ok: true; mine: AddedCase[]; message: string } | { ok: false; error: string; mine?: AddedCase[] };

const NOT_DOCTOR: CaseResult = { ok: false, error: "เฉพาะแพทย์ที่ยืนยันชื่อแล้วเท่านั้น ลองออกจากระบบแล้วเข้าใหม่" };
const FAILED: CaseResult = { ok: false, error: "บันทึกไม่สำเร็จ ลองอีกครั้ง" };

/** Server actions can be called by anyone who can reach the site, so each one checks the doctor again. */
async function signedInDoctor() {
  // getUser() re-checks the signed session and that the number is still authorized.
  const user = await getUser();
  if (!user) return null;
  const pool = await db();
  const doctor = await doctorFor(pool, user.phone);
  return doctor ? { user, doctor, pool } : null;
}

export async function addCase(input: unknown): Promise<CaseResult> {
  try {
    const signed = await signedInDoctor();
    if (!signed) return NOT_DOCTOR;
    const { user, doctor, pool } = signed;
    const today = todayIso();
    const checked = checkCase(input, today);
    if (!checked.ok) return { ok: false, error: checked.error };
    const value = checked.value;

    const holiday = await holidayOn(value.date);
    if (holiday) return { ok: false, error: `${thaiDate(value.date, "short")} เป็นวันหยุด (${holiday.name}) ไม่มีตารางผ่าตัด` };
    if ((await addedToday(pool, doctor.id)) >= DAILY_ADD_LIMIT) {
      return { ok: false, error: `เพิ่มได้ไม่เกิน ${DAILY_ADD_LIMIT} เคสต่อวัน` };
    }

    await insertCase(pool, doctor.id, user.sub, value);
    revalidatePath("/");
    const room = getRoom(value.roomId);
    return {
      ok: true,
      mine: await listCasesBy(pool, doctor.id, today),
      message: `เพิ่มเคสใน ${room ? roomLabel(room) : value.roomId} ${thaiDate(value.date, "short")} แล้ว`,
    };
  } catch (error) {
    console.error("Adding a case failed", error);
    return FAILED;
  }
}

export async function deleteCase(id: unknown): Promise<CaseResult> {
  if (typeof id !== "string" || !/^\d{1,18}$/.test(id)) return FAILED;
  try {
    const signed = await signedInDoctor();
    if (!signed) return NOT_DOCTOR;
    const { doctor, pool } = signed;
    const removed = await removeCase(pool, id, doctor.id);
    revalidatePath("/");
    const mine = await listCasesBy(pool, doctor.id, todayIso());
    return removed ? { ok: true, mine, message: "ลบเคสแล้ว" } : { ok: true, mine, message: "เคสนี้ถูกลบไปแล้ว" };
  } catch (error) {
    console.error("Removing a case failed", error);
    return { ok: false, error: "ลบไม่สำเร็จ ลองอีกครั้ง" };
  }
}
