import { signOut } from "@/auth";

const ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h7A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 10 18.5V17"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M4 12h10m-3-3.5L14.5 12 11 15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Icon-only in the app bar; with `showLabel` a full-width button that names its action. */
export function SignOutButton({ showLabel = false }: { showLabel?: boolean }) {
  return (
    <form
      className={showLabel ? "w-full" : undefined}
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      {showLabel ? (
        <button type="submit" className="btn btn-secondary w-full">
          {ICON}
          ออกจากระบบ
        </button>
      ) : (
        <button
          type="submit"
          aria-label="ออกจากระบบ"
          title="ออกจากระบบ"
          className="btn btn-secondary size-11 min-h-0 shrink-0 p-0"
        >
          {ICON}
        </button>
      )}
    </form>
  );
}
