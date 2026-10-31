import { NextResponse, type NextRequest } from "next/server";
import { userFromToken } from "@/lib/auth/user";
import { cookieName, cookieOptions } from "@/lib/cookies";
import { appUrl } from "@/lib/env";
import { isSameOrigin, safeNextPath } from "@/lib/security";
import { TELEGRAM_WEBHOOK_PATH } from "@/lib/telegram";

/**
 * Runs before every request except static build assets and a few public files (see matcher):
 * 1. canonical-host redirect (production only)
 * 2. CSRF origin check for non-GET requests
 * 3. per-request CSP nonce
 * 4. auth gate: everything except /login*, /api/auth/*, the Telegram webhook and /preview* needs a valid session
 *    (pages ALSO verify the session themselves; this is the first line, not the only one). The /preview pages answer
 *    404 unless NODE_ENV is development.
 * The Telegram webhook is server-to-server (no Origin, no session): its route checks Telegram's secret header.
 */

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === TELEGRAM_WEBHOOK_PATH ||
    pathname === "/preview" ||
    pathname.startsWith("/preview/")
  );
}

function buildCsp(nonce: string, isDev: boolean, https: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://profile.line-scdn.net https://*.line-scdn.net",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "form-action 'self' https://access.line.me",
    "base-uri 'none'",
    "object-src 'none'",
    "manifest-src 'self'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

function withCsp(res: NextResponse, csp: string): NextResponse {
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  let app: URL | null = null;
  try {
    app = appUrl();
  } catch {
    app = null; // misconfigured: nothing below can authenticate anyone
  }

  // 1. Canonical host (e.g. a deployment URL -> APP_URL).
  //    Target is always APP_URL's origin + the same path, so this is not an open redirect.
  if (app && process.env.VERCEL_ENV === "production" && req.headers.get("host") !== app.host) {
    // Path/query are assigned on a URL fixed to APP_URL's origin; leading "//" is collapsed so
    // the Location can never become protocol-relative (Next may relativize same-host redirects).
    const target = new URL(app.origin);
    target.pathname = pathname.replace(/^\/{2,}/, "/");
    target.search = search;
    return NextResponse.redirect(target, 308);
  }

  // 2. CSRF: any state-changing method must come from our own origin (except Telegram's webhook calls).
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && pathname !== TELEGRAM_WEBHOOK_PATH) {
    if (!app || !isSameOrigin(req.headers, app.origin)) {
      return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }

  // 3. CSP nonce, forwarded to Next.js via the request header so it nonces its own scripts.
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development", app?.protocol === "https:");
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  // 4. Auth gate (covers documents, RSC/flight and prefetch requests alike).
  if (!isPublicPath(pathname)) {
    let sessionCookie: string | null = null;
    try {
      sessionCookie = cookieName("session");
    } catch {
      sessionCookie = null;
    }
    const user = sessionCookie ? await userFromToken(req.cookies.get(sessionCookie)?.value) : null;
    if (!user) {
      if (pathname.startsWith("/api/")) {
        return withCsp(
          NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } }),
          csp,
        );
      }
      const login = new URL("/login", req.nextUrl.origin);
      const next = safeNextPath(`${pathname}${search}`);
      if (next !== "/") login.searchParams.set("next", next);
      const res = NextResponse.redirect(login, 307);
      res.headers.set("Cache-Control", "no-store");
      if (sessionCookie && req.cookies.has(sessionCookie)) {
        res.cookies.set(sessionCookie, "", { ...cookieOptions("session"), maxAge: 0 });
      }
      return withCsp(res, csp);
    }
  }

  return withCsp(NextResponse.next({ request: { headers: requestHeaders } }), csp);
}

export const config = {
  matcher: [
    // Everything except build assets and public files that must load on the login page.
    // No "missing: next-router-prefetch" exclusion: prefetch/RSC requests are gated too.
    // (_next/webpack-hmr and __nextjs_* exist only in `next dev`.)
    "/((?!_next/static/|_next/image|_next/webpack-hmr|__nextjs_|favicon\\.ico$|icon\\.svg$|apple-icon\\.png$|robots\\.txt$).*)",
  ],
};
