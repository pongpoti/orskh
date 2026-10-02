import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isUserAllowed } from "@/lib/allowlist";

export const dynamic = "force-dynamic";

export default async function BoardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isUserAllowed(session.user.id)) redirect("/pending");
  if (!session.user.registered) redirect("/register");
  return children;
}
