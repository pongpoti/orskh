/** The app icon as an inline logomark: the chamfered operating-room outline with its live-status dot. */
export function BrandMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#1f4d46" />
      <path d="M-8 150H70L108 188V300L70 338H-8Z" fill="#2f6a61" />
      <path d="M520 174H442L404 212V324L442 362H520Z" fill="#2f6a61" />
      <path d="M176 84H336L400 148V364L336 428H176L112 364V148Z" fill="#c9e4dd" />
      <path
        d="M184 101H328L386 159V353L328 411H184L126 353V159Z"
        fill="none"
        stroke="#8ec9bb"
        strokeWidth="12"
        strokeLinejoin="round"
      />
      <circle cx="256" cy="256" r="54" fill="#1f7a6b" stroke="#fff" strokeWidth="16" />
    </svg>
  );
}
