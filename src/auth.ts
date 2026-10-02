import NextAuth from "next-auth";
import Line from "next-auth/providers/line";
import { accessRedirect } from "@/lib/access";
import { isUserAllowed } from "@/lib/allowlist";
import { findRegistration } from "@/lib/staff";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Line({
      clientId: process.env.AUTH_LINE_ID,
      clientSecret: process.env.AUTH_LINE_SECRET,
    }),
  ],
  callbacks: {
    authorized({ auth: session, request }) {
      const { pathname } = request.nextUrl;
      if (
        pathname.startsWith("/api/auth") ||
        pathname === "/preview" ||
        pathname.startsWith("/preview/")
      ) {
        return true;
      }

      const loggedIn = Boolean(session?.user);
      if (!loggedIn) return pathname === "/login";

      const destination = accessRedirect({
        loggedIn: true,
        allowed: isUserAllowed(session?.user?.id),
        registered: session?.user?.registered === true,
        pathname,
      });
      if (destination) return Response.redirect(new URL(destination, request.nextUrl));
      return true;
    },
    async jwt({ token, account, profile }) {
      if (account?.providerAccountId) {
        token.lineUserId = account.providerAccountId;
      } else if (profile && typeof profile.sub === "string") {
        token.lineUserId = profile.sub;
      }

      const lineUserId = typeof token.lineUserId === "string" ? token.lineUserId : "";
      if (lineUserId && token.registered !== true) {
        const registration = await findRegistration(lineUserId);
        if (registration) {
          token.registered = true;
          token.job = registration.job;
          token.physicianName = registration.physicianName ?? "";
          token.specialty = registration.specialty ?? "";
        }
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.lineUserId === "string" ? token.lineUserId : "";
        session.user.registered = token.registered === true;
        session.user.job = typeof token.job === "string" ? token.job : "";
        session.user.physicianName = typeof token.physicianName === "string" ? token.physicianName : "";
        session.user.specialty = typeof token.specialty === "string" ? token.specialty : "";
      }
      return session;
    },
  },
});

export function lineLoginConfigured(): boolean {
  return Boolean(
    process.env.AUTH_SECRET &&
      process.env.AUTH_LINE_ID &&
      process.env.AUTH_LINE_SECRET,
  );
}
