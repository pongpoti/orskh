import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ProfileAvatar } from "@/components/profile-avatar";
import { SignOutButton } from "@/components/sign-out-button";
import { avatarSrc, initialOf } from "@/lib/avatar";
import { thaiDate } from "@/lib/days";

const ADMIN_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" />
    <circle cx="8.5" cy="7" r="3.5" />
    <path d="M21 19v-1a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

/** One bar: the mark, today's date as the page heading, the admin page for admins, and the account menu behind the avatar. */
export function TopBar({
  name,
  email,
  image,
  date,
  pathname = "/",
  showAccount = true,
  adminHref = null,
}: {
  /** The person's full name (physicians table, else the approved request, else the LINE name). */
  name: string;
  /** The signed-in email, shown under the name in the account menu. */
  email?: string;
  /** LINE profile picture; only https *.line-scdn.net is shown, otherwise the name's first letter. */
  image?: string | null;
  /** Today's date, YYYY-MM-DD. */
  date: string;
  pathname?: string;
  showAccount?: boolean;
  /** The admin page, shown only to admins. */
  adminHref?: string | null;
}) {
  const src = avatarSrc(image);
  const initial = initialOf(name);

  return (
    <header className="appbar z-30">
      <div className="mx-auto flex w-full max-w-[120rem] items-center gap-3 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:px-6 sm:pt-[max(0.625rem,env(safe-area-inset-top))] sm:pb-2.5">
        <Link href={pathname} className="flex min-h-11 shrink-0 items-center rounded-xl" aria-label="ORSKH.APP หน้าแรก">
          <BrandMark className="h-10 rounded-xl px-2.5 text-[1.0625rem] transition-[filter] hover:brightness-115" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs leading-5 font-medium text-muted">ตารางผ่าตัดวันนี้</p>
          <h1 className="truncate text-[0.9375rem] leading-6 font-bold text-ink min-[400px]:text-base sm:text-lg">
            <time dateTime={date}>
              {/* The month is abbreviated on narrow phones so the whole date, year included, fits beside the avatar
                  (and the admin button, which takes another 56px). */}
              <span className={adminHref ? "min-[480px]:hidden" : "min-[400px]:hidden"}>{thaiDate(date, "short")}</span>
              <span className={adminHref ? "hidden min-[480px]:inline" : "hidden min-[400px]:inline"}>{thaiDate(date)}</span>
            </time>
          </h1>
        </div>
        {adminHref ? (
          // Below 390px the button would cut the year off the date, so narrow phones use the account menu's link.
          // Its label shows from 768px; between 640px and 768px the wider date needs the room.
          <Link
            href={adminHref}
            className="btn btn-ghost hidden size-11 min-h-0 shrink-0 p-0 min-[390px]:inline-flex md:w-auto md:px-3.5"
            aria-label="จัดการแพทย์"
            title="จัดการรายชื่อแพทย์"
            data-testid="admin-button"
          >
            {ADMIN_ICON}
            <span className="hidden text-sm md:inline">จัดการแพทย์</span>
          </Link>
        ) : null}
        {showAccount ? (
          <>
            {/* A popover, so a tap outside or Escape closes it without any script. */}
            <button
              type="button"
              popoverTarget="account-menu"
              aria-label={`บัญชี ${name}`}
              data-testid="user-menu"
              className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full sm:pr-3 sm:pl-1 sm:hover:bg-white/70"
            >
              <ProfileAvatar src={src} initial={initial} />
              <span className="hidden max-w-56 truncate text-sm font-medium text-ink-2 sm:block" data-testid="user-name">
                {name}
              </span>
            </button>
            <div
              id="account-menu"
              popover="auto"
              data-testid="account-menu"
              className="menu fixed inset-auto top-[calc(max(0.5rem,env(safe-area-inset-top))+3.5rem)] right-4 sm:right-[max(1.5rem,calc((100vw-120rem)/2+1.5rem))] m-0 w-[min(18rem,calc(100vw-2rem))] p-2 sm:top-[calc(max(0.625rem,env(safe-area-inset-top))+3.75rem)]"
            >
              <div className="flex items-center gap-3 px-2 pt-1.5 pb-3">
                <ProfileAvatar src={src} initial={initial} size={40} />
                <div className="min-w-0">
                  <p className="text-sm leading-snug font-semibold break-words text-ink" data-testid="account-name">
                    {name}
                  </p>
                  {email ? (
                    // The whole address, wrapped (after the @ when it can be): touch screens show no title tooltip,
                    // so cutting it off would hide the domain the session is bound to.
                    <p className="text-xs leading-snug wrap-anywhere text-muted" data-testid="account-email">
                      {email.split("@")[0]}
                      {email.includes("@") ? (
                        <>
                          @<wbr />
                        </>
                      ) : null}
                      {email.split("@").slice(1).join("@")}
                    </p>
                  ) : null}
                </div>
              </div>
              {adminHref ? (
                <Link href={adminHref} className="btn btn-ghost mb-2 w-full" data-testid="account-admin-link">
                  {ADMIN_ICON}
                  จัดการรายชื่อแพทย์
                </Link>
              ) : null}
              <SignOutButton showLabel />
            </div>
            <div className="no-popover-only shrink-0">
              <SignOutButton />
            </div>
          </>
        ) : (
          <span className="flex shrink-0 items-center gap-2">
            <ProfileAvatar src={src} initial={initial} />
            <span className="sr-only sm:not-sr-only sm:block sm:max-w-44 sm:truncate sm:text-sm sm:font-medium sm:text-ink-2">{name}</span>
          </span>
        )}
      </div>
    </header>
  );
}
