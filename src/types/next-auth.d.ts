import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      registered?: boolean;
      job?: string;
      physicianName?: string;
      specialty?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    lineUserId?: string;
    registered?: boolean;
    job?: string;
    physicianName?: string;
    specialty?: string;
  }
}
