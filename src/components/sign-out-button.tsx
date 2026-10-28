"use client";

import { useState } from "react";

const ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h7A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 10 18.5V17"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M4 12h10m-3-3.5L14.5 12 11 15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Icon-only in the app bar; with `showLabel` a full-width button that names its action.
 * POSTs JSON to /api/auth/logout (same origin, so the proxy's Origin check passes), which clears the cookies.
 */
export function SignOutButton({ showLabel = false }: { showLabel?: boolean }) {
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    } finally {
      // Full page load on purpose: drops the client router cache that may hold protected data.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
    }
  }

  const label = busy ? "กำลังออกจากระบบ…" : "ออกจากระบบ";
  return showLabel ? (
    <button type="button" className="btn btn-secondary w-full" onClick={logout} disabled={busy} data-testid="logout">
      {ICON}
      {label}
    </button>
  ) : (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="btn btn-secondary size-11 min-h-0 shrink-0 p-0"
      onClick={logout}
      disabled={busy}
      data-testid="logout-icon"
    >
      {ICON}
    </button>
  );
}
