/**
 * Test mode: every signed-in LINE account may open the board, whatever AUTH_LINE_ALLOWLIST says.
 * It is on unless AUTH_TEST_MODE is set to "false".
 */
export function isTestMode(raw: string | undefined = process.env.AUTH_TEST_MODE): boolean {
  return raw?.trim().toLowerCase() !== "false";
}

/** Outside test mode, an empty or unset allowlist still means every signed-in LINE account may open the board. */
export function isUserAllowed(
  userId: string | undefined,
  raw: string | undefined = process.env.AUTH_LINE_ALLOWLIST,
  testMode: boolean = isTestMode(),
): boolean {
  if (testMode) return true;

  const ids = (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.length === 0) return true;
  return Boolean(userId && ids.includes(userId));
}
