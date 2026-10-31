import { ProfileAvatar } from "@/components/profile-avatar";
import { avatarSrc, initialOf } from "@/lib/avatar";

/**
 * The LINE account and the verified number at the top of the claim and access-request pages. The LINE display name is
 * attacker-controlled: rendered as a text node only.
 */
export function VerifiedIdentity({ lineName, picture, phone }: { lineName: string; picture: string | null; phone: string }) {
  const name = lineName || "ผู้ใช้ LINE";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5" data-testid="request-identity">
      <ProfileAvatar src={avatarSrc(picture)} initial={initialOf(name)} size={40} />
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
  );
}
