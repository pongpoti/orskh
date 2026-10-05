import { signIn } from "@/auth";

/** LINE's own green and white are kept as the brand requires; everything around the button follows the app's system. */
export function LineLoginButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("line", { redirectTo: "/" });
      }}
    >
      <button
        type="submit"
        className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2.5 rounded-[0.625rem] bg-[#06C755] px-4 py-3 text-base font-bold text-white shadow-sm transition duration-150 ease-out hover:bg-[#05b34c] active:translate-y-px active:bg-[#049a42]"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 3C6.5 3 2 6.6 2 11.1c0 4 3.6 7.4 8.5 8l.6 2.2c.1.4.6.4.8.1l2.4-2.1c3.8-.7 6.7-3.7 6.7-7.2C21 6.6 16.5 3 12 3z"
          />
        </svg>
        เข้าสู่ระบบด้วย LINE
      </button>
    </form>
  );
}
