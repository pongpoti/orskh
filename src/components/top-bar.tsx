import Link from "next/link";
import { ProfileAvatar } from "@/components/profile-avatar";
import { SignOutButton } from "@/components/sign-out-button";
import { boardHref, formatThaiDate, shiftDate } from "@/lib/dates";

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
  date,
  today,
  roomId,
  updatedAt,
  pathname = "/",
  showAccount = true,
}: {
  name: string;
  image?: string | null;
  detail?: string;
  date: string;
  today: string;
  roomId: string | null;
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
          <Link href={boardHref(today, null, pathname)} className="text-lg font-semibold tracking-tight text-label">
            orskh
          </Link>
          <span className="truncate rounded-full bg-amber-100/80 px-2 py-0.5 text-xs font-medium text-amber-950">
            ตารางตัวอย่าง
          </span>
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
        <Link className="text-label underline-offset-2 hover:underline" href={boardHref(shiftDate(date, -1), roomId, pathname)}>
          วันก่อน
        </Link>
        <span className="font-medium">{formatThaiDate(date)}</span>
        <Link className="text-label underline-offset-2 hover:underline" href={boardHref(shiftDate(date, 1), roomId, pathname)}>
          วันถัดไป
        </Link>
        {date !== today ? (
          <Link className="rounded-full bg-or/80 px-2 py-0.5 text-label" href={boardHref(today, roomId, pathname)}>
            วันนี้
          </Link>
        ) : null}
        <span className="text-muted">อัปเดต {updatedAt}</span>
      </div>
    </header>
  );
}
