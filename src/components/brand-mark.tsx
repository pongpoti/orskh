/** The app's text mark: a brown tile reading "OR", the R picked out in light tan. */
export function BrandMark({ className = "h-9 px-2.5 text-base rounded-[10px]" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`logo-mark ${className}`}>
      O<b>R</b>
    </span>
  );
}
