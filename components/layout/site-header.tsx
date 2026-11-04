import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";

import { MainNav } from "./main-nav";

export function SiteHeader() {
  return (
    <header className="border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="TrailPlanner home" className="rounded-md">
          <Wordmark />
        </Link>
        <MainNav />
      </div>
    </header>
  );
}
