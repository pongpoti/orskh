import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { VerifiedIdentity } from "@/components/verified-identity";
import { latestRequest, viewFor } from "@/lib/access";
import { getAccessGrant, getUser } from "@/lib/auth/server";
import { isListedUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { claimsEnabled } from "@/lib/telegram";
import { claimBlocked } from "@/lib/user-list";
import { ClaimPanel, type ClaimStart } from "./claim-panel";

export const dynamic = "force-dynamic";

/**
 * After the SMS code, a verified number that holds no name picks its type and then its own name from the users list
 * (first claim wins; the administrators are told and can undo it). Someone not on the list, or whose name is taken,
 * goes on to the access request. A number with a request already goes straight to it, and so does everyone while
 * claims are off (no Telegram administrator to tell, lib/telegram.ts claimsEnabled()).
 */
export default async function ClaimPage() {
  if (await getUser()) redirect("/");
  const grant = await getAccessGrant();
  if (!grant) redirect("/login");
  if (!claimsEnabled()) redirect("/login/request");
  // Holds a name now (claimed on another device, or set by hand): /login/request offers the sign-in.
  if (await isListedUser(grant.phone)) redirect("/login/request");

  let start: ClaimStart = "pick";
  let requested = false;
  try {
    const pool = await db();
    requested = viewFor(await latestRequest(pool, grant.phone), grant.sub) !== "form";
    if (!requested && (await claimBlocked(pool, grant.phone, grant.sub))) start = "blocked";
  } catch (e) {
    console.error("[claim] claim page:", (e as Error).message);
    start = "error";
  }
  if (requested) redirect("/login/request");

  const phone = formatPhone(grant.phone);
  return (
    <AuthShell title="ยืนยันชื่อของคุณ">
      <VerifiedIdentity lineName={grant.name} picture={grant.picture} phone={phone} />
      <div className="mt-5">
        <ClaimPanel start={start} phone={phone} />
      </div>
    </AuthShell>
  );
}
