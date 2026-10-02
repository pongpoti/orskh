import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { staffRegistrations } from "@/db/schema";
import { getPhysician, type JobId } from "@/lib/physicians";

export type StaffProfile = {
  job: string;
  physicianId: string | null;
  physicianName: string | null;
  specialty: string | null;
};

export async function findRegistration(lineUserId: string): Promise<StaffProfile | null> {
  const rows = await getDb()
    .select({
      job: staffRegistrations.job,
      physicianId: staffRegistrations.physicianId,
      physicianName: staffRegistrations.physicianName,
      specialty: staffRegistrations.specialty,
    })
    .from(staffRegistrations)
    .where(eq(staffRegistrations.lineUserId, lineUserId))
    .limit(1);
  return rows[0] ?? null;
}

export async function registerPhysician(input: {
  lineUserId: string;
  lineDisplayName: string | null;
  physicianId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const physician = getPhysician(input.physicianId);
  if (!physician) return { ok: false, error: "ไม่พบชื่อแพทย์ที่เลือก" };

  const taken = await getDb()
    .select({ lineUserId: staffRegistrations.lineUserId })
    .from(staffRegistrations)
    .where(eq(staffRegistrations.physicianId, physician.id))
    .limit(1);
  if (taken[0] && taken[0].lineUserId !== input.lineUserId) {
    return { ok: false, error: "ชื่อนี้มีผู้ลงทะเบียนแล้ว ถ้าไม่ใช่คุณ ให้เลือกชื่อที่ถูกต้อง" };
  }

  const job: JobId = "physician";
  try {
    await getDb()
      .insert(staffRegistrations)
      .values({
        lineUserId: input.lineUserId,
        lineDisplayName: input.lineDisplayName,
        job,
        physicianId: physician.id,
        physicianName: physician.name,
        specialty: physician.specialty,
      })
      .onConflictDoNothing({ target: staffRegistrations.lineUserId });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "23505") {
      return { ok: false, error: "ชื่อนี้มีผู้ลงทะเบียนแล้ว ถ้าไม่ใช่คุณ ให้เลือกชื่อที่ถูกต้อง" };
    }
    throw error;
  }

  return { ok: true };
}
