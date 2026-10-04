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
  today,
  pathname = "/",
  showAccount = true,
}: {
  name: string;
  image?: string | null;
  today: string;
  pathname?: string;
  showAccount?: boolean;
}) {
  const src = profileImageSrc(image);
  const initial = name.trim().slice(0, 1) || "•";

  return (
    <header className="glass glass-bar z-30 border-b border-ink/10 px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] sm:py-3">
      {/* Phones: brand over date on the left, account on the right. sm+: one row, date centred. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[1fr_auto_1fr]">
        <Link
          href={boardHref(today, null, pathname)}
          className="brand-glow col-start-1 row-start-1 w-fit text-lg leading-tight font-semibold tracking-[0.04em] text-label"
        >
          ORSKH.APP
        </Link>
        <p className="col-start-1 row-start-2 truncate text-xs text-muted sm:col-start-2 sm:row-start-1 sm:text-center sm:text-sm sm:font-medium sm:whitespace-nowrap sm:text-ink">
          {formatThaiDate(today)}
        </p>
        <div className="col-start-2 row-span-2 row-start-1 flex min-w-0 items-center gap-2.5 text-sm sm:col-start-3 sm:row-span-1 sm:justify-self-end sm:gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <ProfileAvatar src={src} initial={initial} />
            <span className="block max-w-24 truncate font-medium sm:max-w-48">{name}</span>
          </span>
          {showAccount ? <SignOutButton /> : null}
        </div>
      </div>
    </header>
  );
}
