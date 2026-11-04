# 0007: Manual edits lock days automatically

**Status:** Accepted (2026-11-03)

## Context
Users switch between auto-planning and manual editing. If recalculation silently undid manual changes, users would stop trusting the tool.

## Decision
- Any manual change to a day (endpoint, stop, split, merge) sets `planning_status = USER_EDITED` and `is_locked = true`.
- Locks are visible on day cards and can be removed explicitly. Only then can recalculation change that day.
- Booked stops (`USER_BOOKED`) are pinned regardless of lock state.
- Auto and manual modes share the same `Trek`/`TrekDay` rows. Switching mode never deletes days.

## Consequences
- Recalculation solves only the intervals between pins (see PLANNING_ALGORITHM.md).
- A heavily edited trek may leave little for the planner to change. That is the intended outcome.
