"use client";

import { useState } from "react";

export function ProfileAvatar({ src, initial }: { src: string | null; initial: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-sm font-semibold text-brand ring-1 ring-line"
      >
        {initial}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- LINE profile pictures come from arbitrary hosts
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-8 shrink-0 rounded-full object-cover ring-1 ring-line"
    />
  );
}
