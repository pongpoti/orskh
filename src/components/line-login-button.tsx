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
        className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-[#05B14C] px-4 py-3 text-[1.0625rem] font-bold text-white shadow-[0_1px_2px_rgb(0_0_0/0.1),inset_0_1px_0_rgb(255_255_255/0.2)] transition duration-150 ease-out hover:bg-[#049A42] active:translate-y-px"
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
