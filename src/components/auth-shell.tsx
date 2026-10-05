import { BrandMark } from "@/components/brand-mark";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-[0.06em] text-brand ${className}`}>
      ORSKH<span className="font-medium text-muted">.APP</span>
    </span>
  );
}

const NOTICE_ICON = {
  warning: (
    <>
      <path d="M12 3.5l9 15.5H3z" />
      <path d="M12 10v4.2M12 17.2h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  success: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.4l2.7 2.7L16 9.6" />
    </>
  ),
} as const;

/** An inline message with an icon, so its meaning does not rest on colour. */
export function Notice({
  tone = "info",
  role,
  className = "",
  children,
}: {
  tone?: keyof typeof NOTICE_ICON;
  role?: "alert" | "status";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`notice notice-${tone} ${className}`} role={role}>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {NOTICE_ICON[tone]}
      </svg>
      <div>{children}</div>
    </div>
  );
}

/** Shared frame for the sign-in, registration and access pages. */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex h-dvh overflow-y-auto overscroll-contain bg-canvas px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="card m-auto w-full max-w-md p-6 sm:p-8">
        <div className="flex flex-col items-center text-center">
          <BrandMark className="size-14" />
          <Wordmark className="mt-3 text-sm" />
          <h1 className="mt-5 text-2xl leading-tight font-bold text-ink">{title}</h1>
          {description ? <p className="mt-2 text-sm leading-6 text-muted">{description}</p> : null}
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}
