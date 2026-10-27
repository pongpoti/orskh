/** Postgres error code for a unique-constraint violation. */
export const UNIQUE_VIOLATION = "23505";

/** The Postgres error code behind a failed query. Drizzle wraps driver errors, so the code may sit on `cause`. */
export function pgErrorCode(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 4; depth += 1) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
  return "";
}
