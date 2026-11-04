# Planning algorithm

> **Status: design.** The engine is implemented in Milestone 5 (`lib/planning`). This document
> is the specification it will be tested against. Changes to the approach need an ADR.

The planner divides a trail into daily stages **deterministically and explainably**. It is a
pure TypeScript module: the same inputs always produce the same itinerary, and every decision
can be traced to a rule. An LLM is never the optimization engine.

## Inputs

| Input | Source |
|---|---|
| Profile: `distancesKm[]`, `elevationsM[]` (or incomplete) | `variant_profiles` |
| Direction and total length | `treks`, `trail_variants` |
| Candidate overnight nodes: accommodation POIs with route km, offset, season, reliability | `poi_positions` + `trail_pois` |
| Other POIs (water, food, hazards, passes) | same |
| Pins: locked days, booked stops with arrival dates | `trek_days.is_locked`, `trek_stops` (`USER_BOOKED`) |
| Rest days | `trek_days` with `day_type = REST` |
| Hard limits: max distance, ascent, descent, moving hours; number of days, if fixed | `treks` |
| Soft targets: target distance, target hours, fitness level | `treks` |
| Closures and restrictions | POIs of type `HAZARD` with closure attributes (M5) |

All positions are converted to trek km first (`lib/geo/trek-distance.ts`).

## Stage metrics in O(1)

From the profile, precompute prefix sums of positive and negative elevation deltas, and a
sparse table for maximum elevation. For a stage from trek km *a* to *b* (positions are
interpolated between samples):

- distance = *b − a*
- ascent and descent = differences of the prefix sums
- maximum elevation = sparse-table range maximum
- moving time: DIN 33466-style. Horizontal time *d / 4 km/h*; vertical time *ascent / 300 m/h + descent / 500 m/h*; total = larger + half of smaller. This is scaled by a fitness factor (to be documented with the implementation)
- total time = moving time + planned rest
- water, food, and resupply POIs within *[a, b]*

If elevation is incomplete, the metrics that depend on it are `null`. Constraints on them
cannot be checked, so the result carries a warning rather than a guessed value.

## Graph and solver

1. **Nodes:** trek start, trek end, and candidate overnight points sorted by trek km. Candidates
   are accommodation POIs within the allowed offset of the trail and in season for the date.
   Reliability does not exclude a candidate, but it affects the score, and unconfirmed
   candidates produce warnings (ADR 0006).
2. **Pins** are (day, node) pairs that must hold: the end of each locked day, and each booking on
   its arrival date. They split the trek into **independent intervals**. Recalculation only
   solves unpinned intervals, which makes partial recalculation the normal path.
3. **Edges** (i → j, one hiking day) are created only when every hard limit holds.
4. **Rest days** are fixed day indices with zero distance. They consume a calendar day, and the
   node does not change.
5. **Dynamic programming** over (day index, node) within each interval minimizes the sum of
   stage penalties. Penalties are weighted squared deviations from target distance and time,
   plus penalties for unverified accommodation, high stages, and missing water. Weights are
   named constants with tests. Ties are broken by the lower node index, so results are
   deterministic. Complexity: O(D · V²) per interval, which is trivial at trail scale
   (V ≈ hundreds).
6. If the number of days is not fixed, the solver chooses the day count that minimizes the
   penalty, with a per-day cost.

## Infeasibility

When an interval has no feasible path, the planner returns a structured explanation instead of
an invalid plan. Examples:

- `GAP_EXCEEDS_DAILY_LIMIT`: the stretch between candidates at km *x* and *y* is longer than the maximum daily distance.
- `NOT_ENOUGH_DAYS` / `TOO_MANY_DAYS`: the interval needs between *m* and *n* days, but *k* are available.
- `BOOKING_UNREACHABLE`: booked stop *S* on date *d* cannot be reached within the limits.
- `BOOKINGS_OUT_OF_ORDER`: booking dates contradict their order along the direction of travel.
- `NO_ACCOMMODATION`: there is no candidate within the allowed offset for a required overnight.

Each explanation names the limit involved and the smallest change that would make the plan
feasible, where this can be computed.

## Guarantees (tested in M5 and M6)

- Locked days and `USER_BOOKED` stops are never changed by recalculation.
- Every day's metrics equal the metrics computed from the profile for its km range.
- Stages are contiguous: each day starts where the previous one ended, and the days together cover the whole trek.
- Every output either satisfies all hard limits or is an explanation. Never both, never neither.
