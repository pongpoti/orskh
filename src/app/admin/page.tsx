import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminBar } from "@/components/admin-bar";
import { PhysicianAdmin } from "@/components/physician-admin";
import { isAdmin } from "@/lib/admin";
import { displayNameFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { avatarSrc } from "@/lib/avatar";
import { listSurgeons } from "@/lib/surgeon-store";
import { removeSurgeon, saveSurgeon } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "จัดการรายชื่อแพทย์ · ORSKH.APP" };

/** The admin page: the surgeon list, saved to the database. */
export default async function AdminPage() {
  const user = await requireUser();
  // Admins are listed by LINE user id (the session's sub). Anyone else gets the same page as a mistyped address.
  if (!isAdmin(user.sub)) notFound();

  const [surgeons, name] = await Promise.all([listSurgeons(), displayNameFor(user.phone, user.name)]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AdminBar
        title="จัดการรายชื่อแพทย์"
        name={name}
        // AdminBar hands the picture straight to the avatar, so only LINE's CDN is let through (as on the board).
        image={avatarSrc(user.picture)}
      />
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mx-auto w-full max-w-4xl">
          <PhysicianAdmin initial={surgeons} onSave={saveSurgeon} onRemove={removeSurgeon} />
        </div>
      </main>
    </div>
  );
}
