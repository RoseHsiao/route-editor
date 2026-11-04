import { describe, expect, it } from "vitest";

import { routeKmToTrekKm, trekKmToRouteKm } from "@/lib/geo/trek-distance";

describe("route km ↔ trek km", () => {
  it("is the identity for forward treks", () => {
    expect(routeKmToTrekKm(12.5, 170, "FORWARD")).toBe(12.5);
  });

  it("measures from the far end for reverse treks", () => {
    expect(routeKmToTrekKm(0, 170, "REVERSE")).toBe(170);
    expect(routeKmToTrekKm(170, 170, "REVERSE")).toBe(0);
    expect(routeKmToTrekKm(20, 170, "REVERSE")).toBe(150);
  });

  it("round-trips in both directions", () => {
    for (const direction of ["FORWARD", "REVERSE"] as const) {
      for (const km of [0, 0.001, 42.195, 169.999, 170]) {
        expect(trekKmToRouteKm(routeKmToTrekKm(km, 170, direction), 170, direction)).toBeCloseTo(km, 12);
      }
    }
  });

  it("tolerates floating-point noise at the ends and clamps it", () => {
    expect(routeKmToTrekKm(170 + 1e-12, 170, "FORWARD")).toBe(170);
    expect(routeKmToTrekKm(-1e-12, 170, "REVERSE")).toBe(170);
  });

  it("rejects positions off the route and invalid lengths", () => {
    expect(() => routeKmToTrekKm(170.5, 170, "FORWARD")).toThrow(RangeError);
    expect(() => routeKmToTrekKm(-1, 170, "FORWARD")).toThrow(RangeError);
    expect(() => routeKmToTrekKm(1, 0, "FORWARD")).toThrow(RangeError);
    expect(() => routeKmToTrekKm(Number.NaN, 170, "FORWARD")).toThrow(RangeError);
  });
});
