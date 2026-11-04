"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/trails", label: "Explore trails" },
  { href: "/my-treks", label: "My treks" },
] as const;

export function MainNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex items-center gap-1 text-sm">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground",
              active && "bg-secondary font-medium text-secondary-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
