import Link from "next/link";
import { ProfileAvatar } from "@/components/profile-avatar";
import { SignOutButton } from "@/components/sign-out-button";
import { boardHref, formatThaiDate } from "@/lib/dates";

function profileImageSrc(image: string | null | undefined): string | null {
  if (!image) return null;
  try {
    const url = new URL(image);
    if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "data:") {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function TopBar({
  name,
  image,
  detail,
  today,
  updatedAt,
  pathname = "/",
  showAccount = true,
}: {
  name: string;
  image?: string | null;
  detail?: string;
  today: string;
  updatedAt: string;
  pathname?: string;
  showAccount?: boolean;
}) {
  const src = profileImageSrc(image);
  const initial = name.trim().slice(0, 1) || "•";

  return (
    <header className="glass z-30 flex flex-col gap-2 border-b border-white/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={boardHref(today, null, pathname)} className="brand-glow text-lg font-semibold tracking-[0.04em] text-label">
            ORSKH.APP
          </Link>
        </div>
        <div className="flex min-w-0 items-center gap-3 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <ProfileAvatar src={src} initial={initial} />
            <span className="min-w-0 leading-tight">
              <span className="block max-w-28 truncate font-medium sm:max-w-48">{name}</span>
              {detail ? (
                <span className="block max-w-28 truncate text-xs text-muted sm:max-w-48">{detail}</span>
              ) : null}
            </span>
          </span>
          {showAccount ? <SignOutButton /> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">{formatThaiDate(today)}</span>
        <span className="text-muted">อัปเดต {updatedAt}</span>
      </div>
    </header>
  );
}
