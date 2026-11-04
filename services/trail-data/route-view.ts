import "server-only";

import type { CurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db/client";
import { readDatasetVariantSegments } from "@/lib/db/geometry";
import { profileRuleViolations, validationReportSchema, type Issue } from "@/lib/import/contract";
import type { RouteVariantView, WaypointView } from "@/lib/import/route-view";

export interface ImportedRouteView {
  datasetId: string;
  trailName: string;
  provenance: {
    sourceCategory: "OFFICIAL" | "OPEN_DATA" | "THIRD_PARTY" | "USER_UPLOAD" | "SYNTHETIC";
    sourceName: string;
    sourceUrl: string | null;
    license: string;
    attributionText: string | null;
    redistributionAllowed: boolean | null;
    commercialUseAllowed: boolean | null;
    visibility: "PRIVATE" | "PUBLIC";
    fileType: string;
    importedAt: Date;
  };
  variants: RouteVariantView[];
  waypoints: WaypointView[];
  issues: Issue[];
  /** Stored data that violates the contract. Shown instead of being silently ignored. */
  integrityProblems: string[];
}

/**
 * Everything needed to show an imported dataset, for its owner only. Distances and
 * elevations are read as stored by the worker; nothing is recomputed here.
 */
export async function getImportedRoute(user: CurrentUser, datasetId: string): Promise<ImportedRouteView | null> {
  const dataset = await db().trailDataset.findFirst({
    where: { id: datasetId, ownerUserId: user.id },
    select: {
      id: true,
      sourceCategory: true,
      sourceName: true,
      sourceUrl: true,
      license: true,
      attributionText: true,
      redistributionAllowed: true,
      commercialUseAllowed: true,
      visibility: true,
      fileType: true,
      importedAt: true,
      trail: { select: { name: true } },
      importJobs: { where: { status: "SUCCEEDED" }, select: { validation: true }, take: 1 },
      variants: {
        orderBy: { sourceIndex: "asc" },
        select: {
          id: true,
          name: true,
          sourceKind: true,
          sourceIndex: true,
          isMain: true,
          distanceKm: true,
          ascentM: true,
          descentM: true,
          profile: {
            select: {
              distancesKm: true,
              elevationsM: true,
              elevationComplete: true,
              elevationSource: true,
              segmentStartIndices: true,
              sampleSpacingM: true,
              processingParams: true,
            },
          },
        },
      },
      waypoints: {
        orderBy: { sequence: "asc" },
        select: {
          sequence: true,
          name: true,
          description: true,
          symbol: true,
          sourceType: true,
          longitude: true,
          latitude: true,
          elevationM: true,
        },
      },
    },
  });
  if (!dataset) return null;

  const segments = await readDatasetVariantSegments(db(), dataset.id);
  const integrityProblems: string[] = [];
  const variants: RouteVariantView[] = dataset.variants.map((variant) => {
    const profile = variant.profile
      ? { ...variant.profile, processingParams: variant.profile.processingParams as Record<string, unknown> }
      : null;
    for (const problem of profile ? profileRuleViolations(profile) : ["profile is missing"]) {
      integrityProblems.push(`${variant.name}: ${problem}`);
    }
    return {
      id: variant.id,
      name: variant.name,
      sourceKind: variant.sourceKind,
      sourceIndex: variant.sourceIndex,
      isMain: variant.isMain,
      distanceKm: variant.distanceKm,
      ascentM: variant.ascentM,
      descentM: variant.descentM,
      segments: segments
        .filter((segment) => segment.variantId === variant.id)
        .map((segment) => ({
          sourcePartIndex: segment.sourcePartIndex,
          coordinates: segment.geometry.coordinates,
          hasElevation: segment.hasElevation,
          pointCount: segment.pointCount,
          elevationPointCount: segment.elevationPointCount,
          distanceKm: segment.distanceKm,
        })),
      profile,
    };
  });

  const report = validationReportSchema.safeParse(dataset.importJobs[0]?.validation);
  if (!report.success) integrityProblems.push("The import's validation report could not be read.");

  return {
    datasetId: dataset.id,
    trailName: dataset.trail.name,
    provenance: {
      sourceCategory: dataset.sourceCategory,
      sourceName: dataset.sourceName,
      sourceUrl: dataset.sourceUrl,
      license: dataset.license,
      attributionText: dataset.attributionText,
      redistributionAllowed: dataset.redistributionAllowed,
      commercialUseAllowed: dataset.commercialUseAllowed,
      visibility: dataset.visibility,
      fileType: dataset.fileType,
      importedAt: dataset.importedAt,
    },
    variants,
    waypoints: dataset.waypoints,
    issues: report.success ? report.data.issues : [],
    integrityProblems,
  };
}
