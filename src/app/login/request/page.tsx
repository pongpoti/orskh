import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { ProfileAvatar } from "@/components/profile-avatar";
import { latestRequest, viewFor } from "@/lib/access";
import { getAccessGrant, getUser } from "@/lib/auth/server";
import { isListedPhysician } from "@/lib/authz";
import { avatarSrc, initialOf } from "@/lib/avatar";
import { db } from "@/lib/db";
import { RequestPanel, type PanelView } from "./request-panel";

/** A verified email that is not authorized: request access, wait for the decision, then sign in. */
export default async function RequestPage() {
  if (await getUser()) redirect("/");
  const grant = await getAccessGrant();
  if (!grant) redirect("/login");

  let view: PanelView;
  if (await isListedPhysician(grant.email)) {
    view = "signin"; // added to the physician list meanwhile
  } else {
    try {
      view = viewFor(await latestRequest(await db(), grant.email), grant.sub);
    } catch (e) {
      console.error("[access] request page:", (e as Error).message);
      view = "error";
    }
  }
  // The LINE display name is attacker-controlled: rendered as a text node only.
  const name = grant.name || "ผู้ใช้ LINE";
  return (
    <AuthShell title="ขอสิทธิ์เข้าใช้งาน">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
        <ProfileAvatar src={avatarSrc(grant.picture)} initial={initialOf(name)} size={40} />
        <dl className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-sm leading-6">
          <dt className="text-muted">ชื่อ LINE</dt>
          <dd className="min-w-0 font-semibold break-words text-ink">
            <span data-testid="line-name">{name}</span>
          </dd>
          <dt className="text-muted">อีเมล</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 font-semibold break-words text-ink" data-testid="request-email">
              {grant.email.split("@")[0]}
              {grant.email.includes("@") ? <>@<wbr /></> : null}
              {grant.email.split("@").slice(1).join("@")}
            </span>
            <span className="badge badge-success">ยืนยันแล้ว</span>
          </dd>
        </dl>
      </div>
      <div className="mt-5">
        <RequestPanel initial={view} email={grant.email} />
      </div>
    </AuthShell>
  );
}
