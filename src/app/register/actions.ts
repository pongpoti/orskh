"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isUserAllowed } from "@/lib/allowlist";
import { findRegistration, registerPhysician } from "@/lib/staff";

export async function registerStaff(
  _previous: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!isUserAllowed(session.user.id)) redirect("/pending");

  const existing = await findRegistration(session.user.id);
  if (existing) redirect("/");

  const result = await registerPhysician({
    lineUserId: session.user.id,
    lineDisplayName: session.user.name ?? null,
    physicianId: String(formData.get("physicianId") ?? ""),
  });
  if (!result.ok) return { error: result.error };
  redirect("/");
}
