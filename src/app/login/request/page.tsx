import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { VerifiedIdentity } from "@/components/verified-identity";
import { latestRequest, viewFor } from "@/lib/access";
import { getAccessGrant, getUser } from "@/lib/auth/server";
import { isListedUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { claimsEnabled } from "@/lib/telegram";
import { RequestPanel, type PanelView } from "./request-panel";

/** A verified number that holds no name: request access, wait for the decision, then sign in. */
export default async function RequestPage() {
  if (await getUser()) redirect("/");
  const grant = await getAccessGrant();
  if (!grant) redirect("/login");

  let view: PanelView;
  if (await isListedUser(grant.phone)) {
    view = "signin"; // the number holds a name now (claimed elsewhere, or set by hand)
  } else {
    try {
      view = viewFor(await latestRequest(await db(), grant.phone), grant.sub);
    } catch (e) {
      console.error("[access] request page:", (e as Error).message);
      view = "error";
    }
  }
  const phone = formatPhone(grant.phone);
  return (
    <AuthShell title="ขอสิทธิ์เข้าใช้งาน">
      <VerifiedIdentity lineName={grant.name} picture={grant.picture} phone={phone} />
      <div className="mt-5">
        <RequestPanel initial={view} phone={phone} claims={claimsEnabled()} />
      </div>
    </AuthShell>
  );
}
