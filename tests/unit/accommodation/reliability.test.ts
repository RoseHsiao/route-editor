import { describe, expect, it } from "vitest";

import {
  ACCOMMODATION_RELIABILITY,
  RELIABILITY_INFO,
  isValidPoiReliability,
  recommendationReliability,
} from "@/lib/accommodation/reliability";

describe("accommodation reliability", () => {
  it("treats only a user booking as a booking", () => {
    const bookings = ACCOMMODATION_RELIABILITY.filter((value) => RELIABILITY_INFO[value].isBooking);
    expect(bookings).toEqual(["USER_BOOKED"]);
  });

  it("does not treat unverified or unknown availability as confirmed", () => {
    expect(RELIABILITY_INFO.UNVERIFIED.availabilityConfirmed).toBe(false);
    expect(RELIABILITY_INFO.VERIFIED_AVAILABILITY_UNKNOWN.availabilityConfirmed).toBe(false);
  });

  it("never lets a POI or a recommendation be user-booked", () => {
    expect(isValidPoiReliability("USER_BOOKED")).toBe(false);
    expect(() => recommendationReliability("USER_BOOKED")).toThrow();
    expect(recommendationReliability("UNVERIFIED")).toBe("UNVERIFIED");
  });

  it("has distinct labels so states are never confused in the UI", () => {
    const labels = ACCOMMODATION_RELIABILITY.map((value) => RELIABILITY_INFO[value].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("matches the database enum", async () => {
    const { AccommodationReliability } = await import("@/lib/generated/prisma/enums");
    expect([...ACCOMMODATION_RELIABILITY].sort()).toEqual(Object.values(AccommodationReliability).sort());
  });
});
