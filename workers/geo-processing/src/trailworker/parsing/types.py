"""Format-independent result of parsing a source file, before any normalization."""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ..contract import (
    ELEVATION_MAX_M,
    ELEVATION_MIN_M,
    MAX_ISSUES_PER_CODE,
    CrsInfo,
    Issue,
    Location,
    SourceFormat,
    SourceKind,
)


@dataclass(frozen=True)
class RawPoint:
    lon: float
    lat: float
    #: Valid source elevation in metres, or None when absent or invalid.
    ele: float | None
    time: datetime | None = None


@dataclass
class RawLine:
    """A GPX <trk> or <rte>, or a GeoJSON line feature. Parts are never joined."""

    kind: SourceKind
    source_index: int
    name: str | None
    metadata: dict[str, Any]
    parts: list[list[RawPoint]]


@dataclass(frozen=True)
class RawWaypoint:
    source_index: int
    lon: float
    lat: float
    ele: float | None
    name: str | None = None
    description: str | None = None
    comment: str | None = None
    symbol: str | None = None
    source_type: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ParsedSource:
    format: SourceFormat
    crs: CrsInfo
    name: str | None
    metadata: dict[str, Any]
    lines: list[RawLine]
    waypoints: list[RawWaypoint]
    issues: list[Issue]


class ParseFailedError(Exception):
    """The file cannot be read at all (not well-formed, wrong format, unsupported CRS...)."""

    def __init__(self, issues: list[Issue]) -> None:
        super().__init__("; ".join(issue.message for issue in issues))
        self.issues = issues


class IssueCollector:
    """Collects issues, keeping at most MAX_ISSUES_PER_CODE of each code plus a total count."""

    def __init__(self) -> None:
        self.issues: list[Issue] = []
        self.counts: Counter[str] = Counter()

    def add(self, issue: Issue) -> None:
        self.counts[issue.code] += 1
        if self.counts[issue.code] <= MAX_ISSUES_PER_CODE:
            self.issues.append(issue)

    def finish(self) -> list[Issue]:
        """Appends a summary for every code whose individual issues were truncated."""
        result = list(self.issues)
        for code, count in sorted(self.counts.items()):
            if count > MAX_ISSUES_PER_CODE:
                severity = next(issue.severity for issue in self.issues if issue.code == code)
                result.append(
                    Issue(
                        code=code,
                        severity=severity,
                        message=f"{count} occurrences in total;"
                        f" only the first {MAX_ISSUES_PER_CODE} are listed.",
                        details={"truncated": True, "total": count},
                    )
                )
        return result

    @property
    def has_errors(self) -> bool:
        return any(issue.severity == "error" for issue in self.issues)


def check_coordinate(
    lon: float | None, lat: float | None, location: Location, collector: IssueCollector, *, axis_hint: bool
) -> bool:
    """Validates a WGS 84 position. Never swaps or repairs coordinates."""
    if lon is None or lat is None or not (math.isfinite(lon) and math.isfinite(lat)):
        collector.add(Issue("INVALID_COORDINATE", "error", "Coordinates must be finite numbers.", location))
        return False
    if -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0:
        return True
    details: dict[str, Any] = {"lon": lon, "lat": lat}
    message = f"Coordinate ({lon}, {lat}) is outside the valid longitude/latitude range."
    if axis_hint and -90.0 <= lon <= 90.0 and -180.0 <= lat <= 180.0:
        details["hint"] = "AXIS_ORDER"
        message += (
            " The values would be valid as [latitude, longitude]. GeoJSON requires [longitude, latitude];"
            " the file was not changed."
        )
    collector.add(Issue("INVALID_COORDINATE", "error", message, location, details))
    return False


def check_elevation(value: float | str | None, location: Location, collector: IssueCollector) -> float | None:
    """Returns a usable elevation, or None. Invalid values are reported, never replaced."""
    if value is None:
        return None
    number: float | None
    if isinstance(value, str):
        try:
            number = float(value.strip())
        except ValueError:
            number = None
    else:
        number = float(value)
    if number is None or not math.isfinite(number):
        collector.add(
            Issue(
                "INVALID_ELEVATION",
                "warning",
                f"Elevation {value!r} is not a number.",
                location,
                {"value": str(value)},
            )
        )
        return None
    if not ELEVATION_MIN_M <= number <= ELEVATION_MAX_M:
        collector.add(
            Issue(
                "INVALID_ELEVATION",
                "warning",
                f"Elevation {number} m is outside the plausible range "
                f"[{ELEVATION_MIN_M:g}, {ELEVATION_MAX_M:g}] m and was treated as missing.",
                location,
                {"value": number},
            )
        )
        return None
    return number
