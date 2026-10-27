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
      <div className="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-3 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:px-6 sm:py-3">
        <Link
          href={pathname}
          className="group flex min-w-0 items-center gap-2.5 rounded-[10px]"
          aria-label="ORSKH.APP หน้าแรก"
        >
          <BrandMark className="h-9 shrink-0 rounded-[10px] px-2.5 text-base transition-[filter] group-hover:brightness-125 sm:h-[38px]" />
          <Wordmark className="text-lg leading-none sm:text-xl" />
        </Link>
        <div className="flex min-w-0 items-center gap-3 text-sm">
          <span className="flex min-w-0 items-center gap-2.5">
            <ProfileAvatar src={src} initial={initial} />
            <span className="sr-only sm:not-sr-only sm:block sm:max-w-48 sm:truncate sm:text-[0.95rem] sm:font-medium sm:text-muted">{name}</span>
          </span>
          {showAccount ? (
            <>
              <span aria-hidden className="hidden h-6 w-px bg-line-strong sm:block" />
              <SignOutButton />
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
