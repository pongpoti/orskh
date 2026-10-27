import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ProfileAvatar } from "@/components/profile-avatar";

/** The admin pages' bar: the mark, the page heading, a way back to the board, and who is signed in. */
export function AdminBar({
  title,
  name,
  image,
  boardHref = "/",
}: {
  title: string;
  name: string;
  image?: string | null;
  boardHref?: string;
}) {
  return (
    <header className="appbar z-30">
      <div className="mx-auto flex w-full max-w-[90rem] items-center gap-3 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:px-6 sm:pt-[max(0.625rem,env(safe-area-inset-top))] sm:pb-2.5">
        <Link href={boardHref} className="flex min-h-11 shrink-0 items-center rounded-xl" aria-label="ORSKH.APP หน้าแรก">
          <BrandMark className="h-10 rounded-xl px-2.5 text-[1.0625rem] transition-[filter] hover:brightness-115" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs leading-5 font-medium text-muted">ผู้ดูแลระบบ</p>
          <h1 className="truncate text-[0.9375rem] leading-6 font-bold text-ink min-[400px]:text-base sm:text-lg">{title}</h1>
        </div>
        <Link href={boardHref} className="btn btn-ghost shrink-0 px-3 text-sm sm:px-3.5" aria-label="กลับไปตารางผ่าตัด">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="hidden sm:inline">ตารางผ่าตัด</span>
        </Link>
        <span className="flex shrink-0 items-center gap-2">
          <ProfileAvatar src={image ?? null} initial={name.trim().slice(0, 1) || "•"} />
          <span className="sr-only lg:not-sr-only lg:block lg:max-w-44 lg:truncate lg:text-sm lg:font-medium lg:text-ink-2">{name}</span>
        </span>
      </div>
    </header>
  );
}
