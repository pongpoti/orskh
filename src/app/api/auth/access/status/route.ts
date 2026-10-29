import { NextResponse, type NextRequest } from "next/server";
import { latestRequest, viewFor } from "@/lib/access";
import { accessGrantFor } from "@/lib/access-http";
import { isListedUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { json, MSG } from "@/lib/http";

/** Decision state of this browser's access request; polled by the waiting page (read only). */
export async function GET(req: NextRequest) {
  const grant = await accessGrantFor(req);
  if (grant instanceof NextResponse) return grant;
  // The number holds a name now (claimed on another device, or set by hand): a normal sign-in (LINE + code) works.
  if (await isListedUser(grant.phone)) return json({ status: "signin" });
  try {
    const view = viewFor(await latestRequest(await db(), grant.phone), grant.sub);
    return json({ status: view });
  } catch (e) {
    console.error("[access] status failed:", (e as Error).message);
    return json({ error: MSG.notReady }, 503);
  }
}
