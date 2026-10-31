import { requireUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/** Shell for every protected page. Each page must still call requireUser() itself (layouts do not re-render on navigation). */
export default async function BoardLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return children;
}
