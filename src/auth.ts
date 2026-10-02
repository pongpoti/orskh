import NextAuth from "next-auth";
import Line from "next-auth/providers/line";
import { isUserAllowed } from "@/lib/allowlist";

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
      if (pathname.startsWith("/api/auth") || pathname === "/preview") return true;

      const loggedIn = Boolean(session?.user);
      const allowed = isUserAllowed(session?.user?.id);

      if (pathname === "/login") {
        if (!loggedIn) return true;
        const destination = allowed ? "/" : "/pending";
        return Response.redirect(new URL(destination, request.nextUrl));
      }

      if (!loggedIn) return false;

      if (!allowed) {
        if (pathname === "/pending") return true;
        return Response.redirect(new URL("/pending", request.nextUrl));
      }

      if (pathname === "/pending") {
        return Response.redirect(new URL("/", request.nextUrl));
      }

      return true;
    },
    jwt({ token, account, profile }) {
      if (account?.providerAccountId) {
        token.lineUserId = account.providerAccountId;
      } else if (profile && typeof profile.sub === "string") {
        token.lineUserId = profile.sub;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.lineUserId === "string" ? token.lineUserId : "";
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
