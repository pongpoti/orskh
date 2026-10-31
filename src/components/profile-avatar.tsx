"use client";

import { useState } from "react";

/**
 * The LINE profile picture (callers pass only https *.line-scdn.net URLs, which the CSP allows), or the name's first
 * letter on the tan tint when there is none or it fails to load. Decorative: the name is always shown or announced.
 */
export function ProfileAvatar({ src, initial, size = 34 }: { src: string | null; initial: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };

  if (!src || failed) {
    return (
      <span
        aria-hidden
        style={{ ...box, fontSize: Math.round(size * 0.42) }}
        className="flex shrink-0 items-center justify-center rounded-full bg-brand-tint font-semibold text-ink ring-1 ring-line-strong"
      >
        {initial}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote LINE CDN image, optimizer disabled
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={box}
      referrerPolicy="no-referrer"
      decoding="async"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full object-cover ring-1 ring-line-strong"
    />
  );
}
