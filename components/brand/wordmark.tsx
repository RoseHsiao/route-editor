import { cn } from "@/lib/utils";

/** Logo mark: a ridge line split into stages. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-foreground", className)}>
      <svg viewBox="0 0 28 20" aria-hidden="true" className="h-5 w-7">
        <path
          d="M1 17 L7 9 L10 12 L15 4 L20 11 L23 8 L27 17"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx="10" cy="12" r="1.6" className="fill-primary" />
        <circle cx="20" cy="11" r="1.6" className="fill-primary" />
      </svg>
      {/* Visually hidden on very narrow screens so the main navigation fits; still read out. */}
      <span className="font-heading text-lg font-semibold tracking-tight max-[379px]:sr-only">RouteEditor</span>
    </span>
  );
}
