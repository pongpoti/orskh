import { NextResponse, type NextRequest } from "next/server";
import { accessGrantFor } from "@/lib/access-http";
import { db } from "@/lib/db";
import { json, MSG } from "@/lib/http";
import { isUserType, subtypeLabel } from "@/lib/user-labels";
import { listClaimable } from "@/lib/user-list";
import { claimsEnabled } from "@/lib/telegram";

/**
 * The names of one user type for the claim page (/login/claim): GET ?type=DR|RN|PN|PCA. Only for a browser holding
 * an access cookie (a verified number). Each name carries its id, first and last name, subtype (code and Thai label)
 * and whether it is taken; never a number or a LINE id. Not cached anywhere. While claims are off (claimsEnabled()),
 * the answer sends the page to the access request instead, like POST /api/auth/claim.
 */
export async function GET(req: NextRequest) {
  const grant = await accessGrantFor(req);
  if (grant instanceof NextResponse) return grant;
  if (!claimsEnabled()) return json({ error: MSG.claimsOff, reason: "claims_off", redirect: "/login/request" }, 503);
  const type = req.nextUrl.searchParams.get("type");
  if (!isUserType(type)) return json({ error: MSG.claimType }, 400);
  try {
    const names = await listClaimable(await db(), type);
    return json({
      type,
      names: names.map((n) => ({
        id: n.id,
        first_name: n.first_name,
        last_name: n.last_name,
        subtype: n.subtype,
        subtype_label: subtypeLabel(type, n.subtype),
        claimed: n.claimed,
      })),
    });
  } catch (e) {
    console.error("[claim] list failed:", (e as Error).message);
    return json({ error: MSG.notReady }, 503);
  }
}
