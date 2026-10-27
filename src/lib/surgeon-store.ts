import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { pgErrorCode, UNIQUE_VIOLATION } from "@/db/errors";
import { surgeons } from "@/db/schema";
import type { SpecialtyCode } from "@/lib/specialties";
import { sortSurgeons, type Surgeon } from "@/lib/surgeons";

const columns = { id: surgeons.id, name: surgeons.name, specialty: surgeons.specialty };

export async function listSurgeons(): Promise<Surgeon[]> {
  return sortSurgeons(await getDb().select(columns).from(surgeons));
}

export type SurgeonWrite = { ok: true; surgeon: Surgeon } | { ok: false; reason: "duplicate" | "missing" };

export async function addSurgeon(input: { name: string; specialty: SpecialtyCode }): Promise<SurgeonWrite> {
  const rows = await getDb()
    .insert(surgeons)
    .values(input)
    .onConflictDoNothing({ target: surgeons.name })
    .returning(columns);
  return rows[0] ? { ok: true, surgeon: rows[0] } : { ok: false, reason: "duplicate" };
}

/** A row that is gone reads "missing"; a name another row holds reads "duplicate" (the unique index decides). */
export async function updateSurgeon(id: number, input: { name: string; specialty: SpecialtyCode }): Promise<SurgeonWrite> {
  try {
    const rows = await getDb()
      .update(surgeons)
      .set({ ...input, updatedAt: sql`now()` })
      .where(eq(surgeons.id, id))
      .returning(columns);
    return rows[0] ? { ok: true, surgeon: rows[0] } : { ok: false, reason: "missing" };
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) return { ok: false, reason: "duplicate" };
    throw error;
  }
}

/** The deleted row, or null when it was already gone. */
export async function deleteSurgeon(id: number): Promise<Surgeon | null> {
  const rows = await getDb().delete(surgeons).where(eq(surgeons.id, id)).returning(columns);
  return rows[0] ?? null;
}
