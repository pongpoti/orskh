import type { NextConfig } from "next";

// Static security headers for every response (including /_next/static and public files).
// The per-request CSP with a nonce is set in src/proxy.ts.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // No image optimizer endpoint: nothing to proxy, nothing to gate.
  images: { unoptimized: true },
  // Do not write AGENTS.md / agent rule files into the repository during `next dev`.
  agentRules: false,
  // cacheComponents/PPR stay off: nonce-based CSP needs fully dynamic rendering.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
