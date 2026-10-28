import "server-only";
import { isAuthorizedEmail } from "../authz";
import { sessionSecret } from "../env";
import { verifySession, type SessionUser } from "../tokens";

export type { SessionUser };

/**
 * Authoritative session check: valid signed JWT AND the email is still authorized
 * (an active physicians row, an approved access request, or ALLOWED_EMAILS; see lib/authz.ts).
 */
export async function userFromToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  let secret: string;
  try {
    secret = sessionSecret();
  } catch {
    return null;
  }
  const user = await verifySession(token, secret);
  return user && (await isAuthorizedEmail(user.email)) ? user : null;
}
