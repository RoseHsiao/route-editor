import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="max-w-xl">
          RouteEditor is a planning aid, not a safety guarantee. Check conditions, closures and accommodation
          directly with operators before you go.
        </p>
        <nav aria-label="Footer" className="flex gap-4">
          <Link href="/design-system" className="hover:text-foreground">
            Design system
          </Link>
        </nav>
      </div>
    </footer>
  );
}
