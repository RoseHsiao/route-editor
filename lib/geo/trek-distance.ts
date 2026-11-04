/**
 * Conversion between route km and trek km. Pure: no I/O, no framework imports.
 *
 * Route km is measured along a variant in its stored (forward) direction.
 * Trek km is measured from where the trek starts, in the direction it is walked.
 * Storing one forward profile and mapping positions avoids keeping a reversed copy.
 */

export type Direction = "FORWARD" | "REVERSE";

function assertWithinRoute(km: number, totalKm: number): void {
  if (!Number.isFinite(km) || !Number.isFinite(totalKm) || totalKm <= 0) {
    throw new RangeError("Distances must be finite and the route length positive");
  }
  // Allow for floating-point noise at the ends of the route.
  const tolerance = 1e-9 * Math.max(1, totalKm);
  if (km < -tolerance || km > totalKm + tolerance) {
    throw new RangeError(`Position ${km} km is outside the route (0 to ${totalKm} km)`);
  }
}

function clamp(km: number, totalKm: number): number {
  return Math.min(Math.max(km, 0), totalKm);
}

export function routeKmToTrekKm(routeKm: number, totalKm: number, direction: Direction): number {
  assertWithinRoute(routeKm, totalKm);
  const km = clamp(routeKm, totalKm);
  return direction === "FORWARD" ? km : totalKm - km;
}

/** The mapping is its own inverse. */
export function trekKmToRouteKm(trekKm: number, totalKm: number, direction: Direction): number {
  return routeKmToTrekKm(trekKm, totalKm, direction);
}
