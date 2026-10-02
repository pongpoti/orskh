export function accessRedirect(input: {
  loggedIn: boolean;
  allowed: boolean;
  registered: boolean;
  pathname: string;
}): string | null {
  const { loggedIn, allowed, registered, pathname } = input;
  if (pathname.startsWith("/api/auth") || pathname === "/preview" || pathname.startsWith("/preview/")) {
    return null;
  }
  if (!loggedIn) return pathname === "/login" ? null : "/login";
  if (!allowed) return pathname === "/pending" ? null : "/pending";
  if (!registered) return pathname === "/register" ? null : "/register";
  if (pathname === "/login" || pathname === "/pending" || pathname === "/register") return "/";
  return null;
}
