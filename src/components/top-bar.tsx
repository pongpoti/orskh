import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Wordmark } from "@/components/auth-shell";
import { ProfileAvatar } from "@/components/profile-avatar";
import { SignOutButton } from "@/components/sign-out-button";

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
  pathname = "/",
  showAccount = true,
}: {
  name: string;
  image?: string | null;
  pathname?: string;
  showAccount?: boolean;
}) {
  const src = profileImageSrc(image);
  const initial = name.trim().slice(0, 1) || "•";

  return (
    <header className="appbar z-30">
      <div className="flex items-center justify-between gap-3 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:pt-2.5">
        <Link
          href={pathname}
          className="flex min-w-0 items-center gap-2.5 rounded-lg"
          aria-label="ORSKH.APP หน้าแรก"
        >
          <BrandMark className="size-9 shrink-0" />
          <Wordmark className="text-lg leading-none" />
        </Link>
        <div className="flex min-w-0 items-center gap-2.5 text-sm sm:gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <ProfileAvatar src={src} initial={initial} />
            <span className="sr-only sm:not-sr-only sm:block sm:max-w-48 sm:truncate sm:font-medium sm:text-ink">{name}</span>
          </span>
          {showAccount ? <SignOutButton /> : null}
        </div>
      </div>
    </header>
  );
}
