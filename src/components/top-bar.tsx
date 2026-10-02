import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { boardHref, formatThaiDate, shiftDate } from "@/lib/dates";

export function TopBar({
  name,
  date,
  today,
  roomId,
  updatedAt,
  pathname = "/",
  showAccount = true,
}: {
  name: string;
  date: string;
  today: string;
  roomId: string | null;
  updatedAt: string;
  pathname?: string;
  showAccount?: boolean;
}) {
  return (
    <header className="z-30 flex flex-col gap-2 border-b border-ink/10 bg-white/90 px-4 py-3 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={boardHref(today, null, pathname)} className="text-lg font-semibold tracking-tight text-label">
            orskh
          </Link>
          <span className="truncate rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">
            ตารางตัวอย่าง
          </span>
        </div>
        {showAccount ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden max-w-40 truncate sm:inline">{name}</span>
            <SignOutButton />
          </div>
        ) : (
          <span className="text-sm text-muted">{name}</span>
        )}
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
          <Link className="rounded-full bg-or px-2 py-0.5 text-label" href={boardHref(today, roomId, pathname)}>
            วันนี้
          </Link>
        ) : null}
        <span className="text-muted">อัปเดต {updatedAt}</span>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-or" />ห้องผ่าตัด</li>
          <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-recovery" />ห้องพักฟื้น</li>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-active" />กำลังทำ</li>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-delayed" />เลื่อน</li>
        </ul>
      </div>
    </header>
  );
}
