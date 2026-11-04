# 0006: Accommodation reliability states

**Status:** Accepted (2026-11-03)

## Context
Hikers rely on accommodation. Presenting a suggested hut as available, or as booked, could leave someone without shelter in the mountains. Knowing that a hut exists is not the same as knowing it has a free bed.

## Decision
Four states (`AccommodationReliability`):

| State | Meaning | Where it can appear |
|---|---|---|
| `USER_BOOKED` | The user says they hold a booking (not checked by us) | Trek stops created by the user |
| `VERIFIED_AVAILABILITY` | Availability for the dates confirmed by a trusted source | POIs, trek stops |
| `VERIFIED_AVAILABILITY_UNKNOWN` | The place is verified to operate; availability unknown | POIs, trek stops |
| `UNVERIFIED` | Nothing verified | POIs, trek stops (default for imports) |

- A POI is never treated as available just because it is an accommodation POI. The planner uses accommodation POIs as *candidates*. Unconfirmed candidates get a score penalty and a warning.
- POIs can never be `USER_BOOKED`. System recommendations can never be `USER_BOOKED`. Both rules are enforced by CHECK constraints and unit-tested helpers.
- The UI shows status only through `<ReliabilityBadge>`: text plus icon, never colour alone. Recommendations are prefixed "Suggested".

## Consequences
- Partners or verified sources can later raise reliability without changing the model.
- Copy must never imply availability that is not `VERIFIED_AVAILABILITY` or `USER_BOOKED`.
