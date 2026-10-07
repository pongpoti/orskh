"use client";

import { DAY_NAMES } from "@/lib/days";

function Arrow({ direction, disabled, onClick }: { direction: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn btn-secondary size-10 min-h-0 shrink-0 p-0"
      aria-label={direction === "prev" ? "Previous day" : "Next day"}
      disabled={disabled}
      onClick={onClick}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={direction === "prev" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
      </svg>
    </button>
  );
}

/** The day being shown, large and centred, with arrows and dots. Swiping the plan does the same. */
export function DayBar({ index, onChange }: { index: number; onChange: (next: number) => void }) {
  const last = DAY_NAMES.length - 1;
  return (
    <div className="shrink-0 border-b border-line bg-surface-2">
      <div className="flex items-center justify-between gap-2 px-3 py-0.5 sm:px-4">
        <Arrow direction="prev" disabled={index === 0} onClick={() => onChange(index - 1)} />
        <div className="flex min-w-0 flex-col items-center">
          <h1 aria-live="polite" className="min-w-0 truncate text-center text-lg leading-6 font-bold text-ink sm:text-xl">
            {DAY_NAMES[index]}
          </h1>
          <div role="group" aria-label="Day" className="flex justify-center">
            {DAY_NAMES.map((name, i) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-current={i === index ? "true" : undefined}
                onClick={() => onChange(i)}
                className="flex h-5 w-9 items-center justify-center rounded-md"
              >
                <span className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-brand" : "w-1.5 bg-line-strong"}`} />
              </button>
            ))}
          </div>
        </div>
        <Arrow direction="next" disabled={index === last} onClick={() => onChange(index + 1)} />
      </div>
    </div>
  );
}
