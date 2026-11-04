import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-start gap-4 px-4 py-24 sm:px-6">
        <p className="eyebrow">404</p>
        <h1 className="text-3xl font-semibold">Off the trail</h1>
        <p className="text-muted-foreground">This page does not exist.</p>
        <Link href="/" className="text-primary underline-offset-4 hover:underline">
          Back to the start
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
