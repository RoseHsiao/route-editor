import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl space-y-2">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>
      <h2 className="text-xl font-medium">{title}</h2>
      <div className="max-w-md text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
