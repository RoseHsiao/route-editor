import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Route } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/layout/page-header";
import { listPublishedTrails } from "@/lib/trail/queries";

export const metadata: Metadata = { title: "Explore trails" };

export default function TrailsPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Explore"
        title="Trails"
        description="Long-distance routes you can plan a trek on. Each one shows its data source and licence."
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading trails…</p>}>
        <TrailList />
      </Suspense>
    </div>
  );
}

async function TrailList() {
  await connection();
  const trails = await listPublishedTrails();

  if (trails.length === 0) {
    return (
      <EmptyState icon={<Route />} title="No trails published yet">
        Trail import (GPX and GeoJSON) is the next milestone. Until then there is nothing to browse, and nothing here is
        placeholder data.
      </EmptyState>
    );
  }

  return (
    <ul className="divide-y rounded-xl border bg-card">
      {trails.map((trail) => (
        <li key={trail.id} className="flex items-baseline justify-between gap-4 px-5 py-4">
          <div>
            <p className="font-heading text-lg font-medium">{trail.name}</p>
            <p className="text-sm text-muted-foreground">{trail.region ?? trail.countryCodes.join(", ")}</p>
          </div>
          <p className="metric text-sm text-muted-foreground">
            {trail.totalDistanceKm != null ? `${trail.totalDistanceKm.toFixed(1)} km` : "Distance pending"}
          </p>
        </li>
      ))}
    </ul>
  );
}
