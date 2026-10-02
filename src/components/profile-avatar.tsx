"use client";

import { useState } from "react";

export function ProfileAvatar({ src, initial }: { src: string | null; initial: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-or text-xs font-medium text-label"
      >
        {initial}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-8 shrink-0 rounded-full object-cover"
    />
  );
}
