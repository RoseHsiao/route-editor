/**
 * What we know about staying overnight somewhere. Pure.
 * See docs/adr/0006-accommodation-reliability.md.
 *
 * Mirrors the AccommodationReliability database enum. Kept as a literal union
 * here so UI and planning code do not depend on the generated Prisma client.
 */

export const ACCOMMODATION_RELIABILITY = [
  "USER_BOOKED",
  "VERIFIED_AVAILABILITY",
  "VERIFIED_AVAILABILITY_UNKNOWN",
  "UNVERIFIED",
] as const;

export type AccommodationReliability = (typeof ACCOMMODATION_RELIABILITY)[number];

export interface ReliabilityInfo {
  label: string;
  description: string;
  /** The user holds a booking. Only USER_BOOKED. */
  isBooking: boolean;
  /** Someone has confirmed a bed is available for the dates. */
  availabilityConfirmed: boolean;
  tone: "booked" | "confirmed" | "caution" | "unknown";
}

export const RELIABILITY_INFO: Record<AccommodationReliability, ReliabilityInfo> = {
  USER_BOOKED: {
    label: "Booked",
    description: "You told us you hold a booking here. TrailPlanner has not checked it.",
    isBooking: true,
    availabilityConfirmed: true,
    tone: "booked",
  },
  VERIFIED_AVAILABILITY: {
    label: "Availability confirmed",
    description: "Availability for these dates was confirmed by a trusted source. Not booked.",
    isBooking: false,
    availabilityConfirmed: true,
    tone: "confirmed",
  },
  VERIFIED_AVAILABILITY_UNKNOWN: {
    label: "Availability unknown",
    description: "This place is known to operate, but nobody has confirmed a bed for these dates.",
    isBooking: false,
    availabilityConfirmed: false,
    tone: "caution",
  },
  UNVERIFIED: {
    label: "Unverified",
    description: "Not verified. It may be closed, full, or no longer exist. Check before relying on it.",
    isBooking: false,
    availabilityConfirmed: false,
    tone: "unknown",
  },
};

/**
 * Reliability values a POI may carry. USER_BOOKED belongs to a user's trek stop,
 * never to shared POI data (also enforced by a database CHECK constraint).
 */
export function isValidPoiReliability(value: AccommodationReliability): boolean {
  return value !== "USER_BOOKED";
}

/**
 * The reliability a system recommendation inherits from its POI.
 * A recommendation can never claim to be a booking.
 */
export function recommendationReliability(poiReliability: AccommodationReliability): AccommodationReliability {
  if (poiReliability === "USER_BOOKED") {
    throw new Error("A POI cannot be USER_BOOKED; bookings belong to trek stops");
  }
  return poiReliability;
}
