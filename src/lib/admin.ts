/**
 * Admins may open /admin and edit the surgeon list. They are named by LINE user id in AUTH_ADMIN_LINE_IDS,
 * comma-separated: the session's `sub`, which is the LINE user id. To find someone's id, have them sign in once, then
 * `SELECT line_sub FROM line_bindings WHERE email = lower('them@example.com');`. Unset or empty means there is no admin.
 */
export function adminIds(raw: string | undefined = process.env.AUTH_ADMIN_LINE_IDS): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isAdmin(userId: string | null | undefined, raw: string | undefined = process.env.AUTH_ADMIN_LINE_IDS): boolean {
  return Boolean(userId) && adminIds(raw).includes(userId as string);
}
