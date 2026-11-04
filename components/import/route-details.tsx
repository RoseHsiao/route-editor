import { CircleAlert, Info, MapPin, TriangleAlert } from "lucide-react";

import { ElevationProfile } from "@/components/import/elevation-profile";
import { RouteMap } from "@/components/import/route-map";
import type { Issue } from "@/lib/import/contract";
import {
  buildMapData,
  elevationCoverage,
  formatKm,
  formatMetres,
  groupIssues,
  ISSUE_TITLES,
  profileBreaksKm,
  profileChartPoints,
  SOURCE_KIND_LABELS,
  type RouteVariantView,
} from "@/lib/import/route-view";
import { mapStyleUrl } from "@/lib/map/config";
import { cn } from "@/lib/utils";
import type { ImportedRouteView } from "@/services/trail-data/route-view";

const CATEGORY_LABELS = {
  USER_UPLOAD: "Your upload",
  THIRD_PARTY: "Third-party data",
  OPEN_DATA: "Open data",
  OFFICIAL: "Official source",
  SYNTHETIC: "Synthetic test data",
} as const;

const KIND_SWATCH = {
  TRACK: "border-t-4 border-trail",
  ROUTE: "border-t-4 border-dashed border-trail-alternative",
  LINE: "border-t-4 border-info",
} as const;

export function SourceKindBadge({ variant }: { variant: Pick<RouteVariantView, "sourceKind"> }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium" title={SOURCE_KIND_LABELS[variant.sourceKind].description}>
      <span aria-hidden="true" className={cn("inline-block w-5", KIND_SWATCH[variant.sourceKind])} />
      {SOURCE_KIND_LABELS[variant.sourceKind].label}
    </span>
  );
}

function tri(value: boolean | null): string {
  return value === null ? "Unknown (treated as not allowed)" : value ? "Allowed" : "Not allowed";
}

function Provenance({ route }: { route: ImportedRouteView }) {
  const p = route.provenance;
  return (
    <section aria-labelledby="provenance" className="space-y-3 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="provenance" className="text-lg font-medium">
          Source
        </h2>
        <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium">{CATEGORY_LABELS[p.sourceCategory]}</span>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">
          {p.visibility === "PRIVATE" ? "Private to you" : "Public"}
        </span>
      </div>
      {p.sourceCategory !== "OFFICIAL" ? (
        <p className="text-sm text-muted-foreground">
          Imported data, not official trail data. It has not been checked against the trail&apos;s managing body.
        </p>
      ) : null}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">Source</dt>
        <dd>
          {p.sourceUrl ? (
            <a href={p.sourceUrl} rel="noopener noreferrer nofollow" target="_blank" className="underline underline-offset-2">
              {p.sourceName}
            </a>
          ) : (
            p.sourceName
          )}
        </dd>
        <dt className="text-muted-foreground">Licence</dt>
        <dd>{p.license === "UNKNOWN" ? "Unknown" : p.license}</dd>
        {p.attributionText ? (
          <>
            <dt className="text-muted-foreground">Attribution</dt>
            <dd>{p.attributionText}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Redistribution</dt>
        <dd>{tri(p.redistributionAllowed)}</dd>
        <dt className="text-muted-foreground">Commercial use</dt>
        <dd>{tri(p.commercialUseAllowed)}</dd>
        <dt className="text-muted-foreground">File</dt>
        <dd>
          {p.fileType}, imported {p.importedAt.toISOString().slice(0, 10)}
        </dd>
      </dl>
    </section>
  );
}

function VariantSection({ variant }: { variant: RouteVariantView }) {
  const points = variant.profile ? profileChartPoints(variant.profile) : null;
  const breaks = variant.profile ? profileBreaksKm(variant.profile) : [];
  const segments = variant.segments.length;
  const coverage = elevationCoverage(variant);
  return (
    <section aria-labelledby={`variant-${variant.id}`} className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`variant-${variant.id}`} className="text-lg font-medium">
          {variant.name}
          {variant.isMain ? <span className="ml-2 text-xs font-normal text-muted-foreground">main</span> : null}
        </h3>
        <SourceKindBadge variant={variant} />
      </div>
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Distance</dt>
          <dd className="metric text-lg">{formatKm(variant.distanceKm)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Ascent</dt>
          <dd className="metric text-lg">{formatMetres(variant.ascentM)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Descent</dt>
          <dd className="metric text-lg">{formatMetres(variant.descentM)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Source segments</dt>
          <dd className="metric text-lg">{segments}</dd>
        </div>
      </dl>
      {segments > 1 ? (
        <p className="text-xs text-muted-foreground">
          The segments are not connected. Distance counts only the recorded segments, not the space between them.
        </p>
      ) : null}
      {variant.sourceKind === "ROUTE" ? (
        <p className="text-xs text-muted-foreground">{SOURCE_KIND_LABELS.ROUTE.description}</p>
      ) : null}
      {points ? (
        <>
          <ElevationProfile points={points} breaksKm={breaks} label={variant.name} />
          <p className="text-xs text-muted-foreground">
            Elevation from the source file, resampled every {variant.profile?.sampleSpacingM} m and smoothed. Raw values
            are kept unchanged.
          </p>
        </>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Elevation profile unavailable:{" "}
          {coverage.withElevation === 0
            ? "the source has no elevation for this line."
            : `elevation is incomplete (${coverage.withElevation.toLocaleString("en")} of ${coverage.points.toLocaleString("en")} points have a valid value).`}{" "}
          Missing values are not filled in, so ascent and descent are not shown.
        </p>
      )}
    </section>
  );
}

const SEVERITY_STYLE = {
  error: { icon: CircleAlert, className: "text-destructive", label: "Error" },
  warning: { icon: TriangleAlert, className: "text-caution-foreground dark:text-caution", label: "Warning" },
  info: { icon: Info, className: "text-muted-foreground", label: "Note" },
} as const;

function locationText(issue: Issue): string | null {
  const l = issue.location;
  if (!l) return null;
  const parts: string[] = [];
  if (l.km !== undefined) parts.push(`at ${l.km.toFixed(2)} km`);
  if (l.lineIndex !== undefined) parts.push(`line ${l.lineIndex + 1}`);
  if (l.partIndex !== undefined) parts.push(`segment ${l.partIndex + 1}`);
  if (l.pointIndex !== undefined) parts.push(`point ${l.pointIndex + 1}`);
  if (l.waypointIndex !== undefined) parts.push(`waypoint ${l.waypointIndex + 1}`);
  if (l.featureIndex !== undefined) parts.push(`feature ${l.featureIndex + 1}`);
  return parts.length ? parts.join(", ") : null;
}

export function IssueList({ issues, title = "Data quality" }: { issues: readonly Issue[]; title?: string }) {
  if (issues.length === 0) {
    return (
      <section aria-labelledby="issues" className="rounded-xl border bg-card p-5">
        <h2 id="issues" className="text-lg font-medium">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">No problems were found in the file.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="issues" className="space-y-3 rounded-xl border bg-card p-5">
      <h2 id="issues" className="text-lg font-medium">
        {title}
      </h2>
      <ul className="space-y-3">
        {groupIssues(issues).map((group) => {
          const style = SEVERITY_STYLE[group.severity];
          const Icon = style.icon;
          return (
            <li key={group.code} className="space-y-1">
              <p className={cn("flex items-center gap-2 text-sm font-medium", style.className)}>
                <Icon aria-hidden="true" className="size-4" />
                <span className="sr-only">{style.label}: </span>
                {ISSUE_TITLES[group.code] ?? group.code}
                <span className="font-normal text-muted-foreground">({group.items.length})</span>
              </p>
              <ul className="ml-6 list-disc space-y-0.5 text-sm text-muted-foreground">
                {group.items.slice(0, 8).map((issue, index) => {
                  const where = locationText(issue);
                  return (
                    <li key={index}>
                      {issue.message}
                      {where ? <span className="metric"> ({where})</span> : null}
                    </li>
                  );
                })}
                {group.items.length > 8 ? <li>and {group.items.length - 8} more.</li> : null}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function RouteDetails({ route }: { route: ImportedRouteView }) {
  const mapData = buildMapData(route.variants, route.waypoints, route.issues);
  const kinds = [...new Set(route.variants.map((variant) => variant.sourceKind))];
  return (
    <div className="space-y-8">
      {route.integrityProblems.length > 0 ? (
        <div role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
          Stored data for this import is inconsistent and may be shown incompletely: {route.integrityProblems.join("; ")}.
        </div>
      ) : null}

      <Provenance route={route} />

      <section aria-labelledby="map" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="map" className="text-lg font-medium">
            Map
          </h2>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {kinds.map((kind) => (
              <SourceKindBadge key={kind} variant={{ sourceKind: kind }} />
            ))}
            {route.waypoints.length > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin aria-hidden="true" className="size-3.5" /> Waypoint
              </span>
            ) : null}
            {mapData.issues.features.length > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block size-2.5 rounded-full bg-caution" /> Data-quality issue
              </span>
            ) : null}
          </div>
        </div>
        <RouteMap data={mapData} styleUrl={mapStyleUrl()} />
      </section>

      <div className="space-y-4">
        <h2 className="text-lg font-medium">Lines in this file</h2>
        {route.variants.map((variant) => (
          <VariantSection key={variant.id} variant={variant} />
        ))}
      </div>

      <IssueList issues={route.issues} />

      <section aria-labelledby="waypoints" className="space-y-3 rounded-xl border bg-card p-5">
        <h2 id="waypoints" className="text-lg font-medium">
          Standalone waypoints
        </h2>
        {route.waypoints.length === 0 ? (
          <p className="text-sm text-muted-foreground">The file has no standalone waypoints.</p>
        ) : (
          <ul className="divide-y text-sm">
            {route.waypoints.map((waypoint) => (
              <li key={waypoint.sequence} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  {waypoint.name ?? <span className="text-muted-foreground">Unnamed</span>}
                  {waypoint.symbol ? <span className="ml-2 text-xs text-muted-foreground">{waypoint.symbol}</span> : null}
                </span>
                <span className="metric text-xs text-muted-foreground">
                  {waypoint.latitude.toFixed(5)}, {waypoint.longitude.toFixed(5)} ·{" "}
                  {waypoint.elevationM === null ? "no elevation" : formatMetres(waypoint.elevationM)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Waypoints are shown as the file describes them. They are not verified points of interest.
        </p>
      </section>
    </div>
  );
}
