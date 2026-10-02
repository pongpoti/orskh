/** Empty or unset means every signed-in LINE account may open the board. */
export function isUserAllowed(
  userId: string | undefined,
  raw: string | undefined = process.env.AUTH_LINE_ALLOWLIST,
): boolean {
  const ids = (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.length === 0) return true;
  return Boolean(userId && ids.includes(userId));
}
