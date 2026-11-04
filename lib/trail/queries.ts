import "server-only";

import { db } from "@/lib/db/client";

export interface TrailSummary {
  id: string;
  slug: string;
  name: string;
  region: string | null;
  countryCodes: string[];
  totalDistanceKm: number | null;
  totalAscentM: number | null;
}

export async function listPublishedTrails(): Promise<TrailSummary[]> {
  return db().trail.findMany({
    where: { isPublished: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      region: true,
      countryCodes: true,
      totalDistanceKm: true,
      totalAscentM: true,
    },
  });
}
