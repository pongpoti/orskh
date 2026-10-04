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
    <header className="glass z-30 border-b border-white/40 px-4 py-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="min-w-0 justify-self-start">
          <Link href={boardHref(today, null, pathname)} className="brand-glow text-lg font-semibold tracking-[0.04em] text-label">
            ORSKH.APP
          </Link>
        </div>
        <p className="justify-self-center text-center text-sm font-medium whitespace-nowrap">
          {formatThaiDate(today)}
        </p>
        <div className="flex min-w-0 items-center justify-self-end gap-3 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <ProfileAvatar src={src} initial={initial} />
            <span className="block max-w-28 truncate font-medium sm:max-w-48">{name}</span>
          </span>
          {showAccount ? <SignOutButton /> : null}
        </div>
      </div>
    </header>
  );
}
