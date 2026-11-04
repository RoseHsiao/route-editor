import { BedDouble, CircleCheck, CircleHelp, TriangleAlert } from "lucide-react";

import { RELIABILITY_INFO, type AccommodationReliability } from "@/lib/accommodation/reliability";
import { cn } from "@/lib/utils";

const TONE_CLASSES = {
  booked: "bg-primary text-primary-foreground",
  confirmed: "bg-secondary text-secondary-foreground",
  caution: "bg-caution/25 text-caution-foreground dark:text-caution",
  unknown: "border border-dashed border-muted-foreground/50 text-muted-foreground",
} as const;

const TONE_ICONS = {
  booked: BedDouble,
  confirmed: CircleCheck,
  caution: TriangleAlert,
  unknown: CircleHelp,
} as const;

/**
 * The only way accommodation status is shown. Text always accompanies the
 * colour, and unconfirmed states never look like confirmed ones (ADR 0006).
 */
export function ReliabilityBadge({
  reliability,
  recommended = false,
  className,
}: {
  reliability: AccommodationReliability;
  /** Suggested by RouteEditor rather than chosen by the user. */
  recommended?: boolean;
  className?: string;
}) {
  const info = RELIABILITY_INFO[reliability];
  const Icon = TONE_ICONS[info.tone];
  return (
    <span
      title={info.description}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[info.tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {recommended ? `Suggested · ${info.label}` : info.label}
    </span>
  );
}
