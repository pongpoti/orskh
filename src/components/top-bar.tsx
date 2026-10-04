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
    <header className="glass glass-bar z-30 border-b border-ink/10 px-4 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2 sm:pt-3">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={boardHref(today, null, pathname)}
          className="brand-glow w-fit text-lg leading-tight font-semibold tracking-[0.04em] text-label"
        >
          ORSKH.APP
        </Link>
        <div className="flex min-w-0 items-center gap-2.5 text-sm sm:gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <ProfileAvatar src={src} initial={initial} />
            <span className="block max-w-32 truncate font-medium sm:max-w-48">{name}</span>
          </span>
          {showAccount ? <SignOutButton /> : null}
        </div>
      </div>
      <p className="mt-2 border-t border-ink/10 pt-2 text-center text-xl font-bold text-ink sm:text-2xl">
        {formatThaiDate(today)}
      </p>
    </header>
  );
}
