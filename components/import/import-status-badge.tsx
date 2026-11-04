import { cn } from "@/lib/utils";

const STATUS = {
  PENDING: { label: "Waiting", className: "border border-dashed text-muted-foreground" },
  PROCESSING: { label: "Processing", className: "bg-info/15 text-info-foreground dark:text-info" },
  SUCCEEDED: { label: "Imported", className: "bg-secondary text-secondary-foreground" },
  FAILED: { label: "Failed", className: "bg-destructive/10 text-destructive" },
  CANCELLED: { label: "Cancelled", className: "border text-muted-foreground" },
} as const;

export function ImportStatusBadge({ status }: { status: keyof typeof STATUS }) {
  const info = STATUS[status];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-medium", info.className)}>
      {info.label}
    </span>
  );
}
