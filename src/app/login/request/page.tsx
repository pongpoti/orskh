import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { ProfileAvatar } from "@/components/profile-avatar";
import { latestRequest, viewFor } from "@/lib/access";
import { getAccessGrant, getUser } from "@/lib/auth/server";
import { isListedPhysician } from "@/lib/authz";
import { avatarSrc, initialOf } from "@/lib/avatar";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { RequestPanel, type PanelView } from "./request-panel";

/** A verified number that is not authorized: request access, wait for the decision, then sign in. */
export default async function RequestPage() {
  if (await getUser()) redirect("/");
  const grant = await getAccessGrant();
  if (!grant) redirect("/login");

  let view: PanelView;
  if (await isListedPhysician(grant.phone)) {
    view = "signin"; // added to the physician list meanwhile
  } else {
    try {
      view = viewFor(await latestRequest(await db(), grant.phone), grant.sub);
    } catch (e) {
      console.error("[access] request page:", (e as Error).message);
      view = "error";
    }
  }
  // The LINE display name is attacker-controlled: rendered as a text node only.
  const name = grant.name || "ผู้ใช้ LINE";
  const phone = formatPhone(grant.phone);
  return (
    <AuthShell title="ขอสิทธิ์เข้าใช้งาน">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5" data-testid="request-identity">
        <ProfileAvatar src={avatarSrc(grant.picture)} initial={initialOf(name)} size={40} />
        {/* Below 360 px the label goes above its value: the number never breaks, and beside the label it would overflow. */}
        <dl className="grid min-w-0 flex-1 grid-cols-1 items-baseline gap-x-3 gap-y-0 text-sm leading-6 min-[22.5rem]:grid-cols-[auto_minmax(0,1fr)] min-[22.5rem]:gap-y-1">
          <dt className="text-muted">ชื่อ LINE</dt>
          <dd className="min-w-0 font-semibold break-words text-ink">
            <span data-testid="line-name">{name}</span>
          </dd>
          <dt className="text-muted">เบอร์มือถือ</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold whitespace-nowrap text-ink tabular-nums" data-testid="request-phone">
              {phone}
            </span>
            <span className="badge badge-success">ยืนยันแล้ว</span>
          </dd>
        </dl>
      </div>
      <div className="mt-5">
        <RequestPanel initial={view} phone={phone} />
      </div>
    </AuthShell>
  );
}
