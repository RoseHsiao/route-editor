import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Backpack } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/layout/page-header";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db/client";

export const metadata: Metadata = { title: "My treks" };

export default function MyTreksPage() {
  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Plans" title="My treks" description="Your saved trek plans." />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading treks…</p>}>
        <TrekList />
      </Suspense>
    </div>
  );
}

async function TrekList() {
  await connection();
  const user = await getCurrentUser();
  if (!user) {
    return (
      <EmptyState icon={<Backpack />} title="Sign-in is not available yet">
        Accounts arrive in Milestone 4. In local development, set AUTH_DEV_STUB=true to use the development user.
      </EmptyState>
    );
  }

  const treks = await db().trek.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, startDate: true, status: true },
  });

  if (treks.length === 0) {
    return (
      <EmptyState icon={<Backpack />} title="No treks yet">
        Once trails can be imported you will be able to create a trek from any of them.
      </EmptyState>
    );
  }

  return (
    <ul className="divide-y rounded-xl border bg-card">
      {treks.map((trek) => (
        <li key={trek.id} className="flex items-baseline justify-between gap-4 px-5 py-4">
          <p className="font-heading text-lg font-medium">{trek.name}</p>
          <p className="metric text-sm text-muted-foreground">{trek.startDate.toISOString().slice(0, 10)}</p>
        </li>
      ))}
    </ul>
  );
}
