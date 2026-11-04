"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/trails", label: "Explore trails", short: "Explore" },
  { href: "/my-treks", label: "My treks", short: "Treks" },
  { href: "/imports", label: "Imports", short: "Imports" },
] as const;

/**
 * `usePathname` suspends on routes with request-time params (e.g. /imports/[id]) under
 * Cache Components, so the active state streams in; the fallback is the same links
 * without it. See node_modules/next/dist/docs (use-pathname, "Suspense").
 */
export function MainNav() {
  return (
    <Suspense fallback={<NavLinks pathname={null} />}>
      <ActiveNavLinks />
    </Suspense>
  );
}

function ActiveNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}

function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main" className="flex items-center gap-1 text-sm">
      {LINKS.map((link) => {
        const active = pathname !== null && (pathname === link.href || pathname.startsWith(`${link.href}/`));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            aria-label={link.label}
            className={cn(
              "rounded-md px-2 py-1.5 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:px-3",
              active && "bg-secondary font-medium text-secondary-foreground",
            )}
          >
            <span className="sm:hidden">{link.short}</span>
            <span className="hidden sm:inline">{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
