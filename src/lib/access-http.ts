import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { cookieName } from "./cookies";
import { appUrl, ConfigError, databaseUrl, sessionSecret } from "./env";
import { json, MSG } from "./http";
import { verifyAccess, type AccessGrant } from "./tokens";

/**
 * Shared by /api/auth/access/*: configuration check, then the access cookie (a verified number that is not
 * authorized). Returns the grant, or the error response to send.
 */
export async function accessGrantFor(req: NextRequest): Promise<AccessGrant | NextResponse> {
  let secret: string;
  try {
    appUrl();
    databaseUrl();
    secret = sessionSecret();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error("[access] not configured:", e.names.join(", "));
      return json({ error: MSG.notReady }, 503);
    }
    throw e;
  }
  const grant = await verifyAccess(req.cookies.get(cookieName("access"))?.value, secret);
  return grant ?? json({ error: MSG.sessionExpired, restart: true }, 401);
}
