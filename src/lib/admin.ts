/**
 * Admins may open /admin and edit the surgeon list. They are named by LINE user id in AUTH_ADMIN_LINE_IDS,
 * comma-separated (the id a signed-in account sees on /pending). Unset or empty means there is no admin.
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
