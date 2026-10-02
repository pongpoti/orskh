import { signOut } from "@/auth";

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button
        type="submit"
        className="rounded-full border border-ink/15 px-3 py-1 text-sm text-ink hover:bg-floor"
      >
        ออกจากระบบ
      </button>
    </form>
  );
}
