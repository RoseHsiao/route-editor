"""Validation and normalization of a parsed source into the contract's normalized import.

Rules (documented in docs/IMPORT_PIPELINE.md):

- Each source part (GPX <trkseg>, the single <rte>, each MultiLineString part) becomes
  one segment. Parts are never joined; the distance between them is reported, not added.
- Consecutive points with identical coordinates are removed (the first one is kept).
- Spikes are reported, never removed. Large gaps inside a part are reported; for tracks
  and GeoJSON lines a gap above the failure threshold fails the import. Route legs
  (<rtept> to <rtept>) are planned straight connections, so long legs are only noted.
- Elevation is complete for a segment only if every kept vertex has a valid value.
  Otherwise the segment is stored 2D and the line's profile is incomplete.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import PROCESSOR_VERSION
from .contract import (
    CONTRACT_VERSION,
    DEFAULT_GAP_FAIL_M,
    DEFAULT_GAP_WARN_M,
    MAX_POINTS,
    ROUTE_LONG_LEG_M,
    SPIKE_DETOUR_RATIO,
    SPIKE_MAX_SPEED_MPS,
    SPIKE_MIN_LEG_M,
    Issue,
    Location,
    SourceKind,
)
from .geodesy import distance_m, leg_lengths_m
from .parsing.types import IssueCollector, ParsedSource, RawLine, RawPoint, RawWaypoint
from .profile import Profile, Vertex, build_profile


@dataclass(frozen=True)
class ImportOptions:
    gap_warn_m: float = DEFAULT_GAP_WARN_M
    gap_fail_m: float = DEFAULT_GAP_FAIL_M

    @classmethod
    def from_json(cls, options: dict[str, Any]) -> ImportOptions:
        warn = options.get("gapWarnM", DEFAULT_GAP_WARN_M)
        fail = options.get("gapFailM", DEFAULT_GAP_FAIL_M)
        if not all(isinstance(value, int | float) and not isinstance(value, bool) for value in (warn, fail)):
            raise ValueError("gap thresholds must be numbers")
        if not 0 < float(warn) <= float(fail):
            raise ValueError("gap thresholds must satisfy 0 < gapWarnM <= gapFailM")
        return cls(gap_warn_m=float(warn), gap_fail_m=float(fail))

    def to_json(self) -> dict[str, float]:
        return {"gapWarnM": self.gap_warn_m, "gapFailM": self.gap_fail_m}


@dataclass(frozen=True)
class NormalizedSegment:
    source_part_index: int
    vertices: list[Vertex]
    elevation_point_count: int
    distance_km: float
    ascent_m: float | None
    descent_m: float | None

    @property
    def has_elevation(self) -> bool:
        return self.elevation_point_count == len(self.vertices)

    def to_json(self) -> dict[str, Any]:
        return {
            "sourcePartIndex": self.source_part_index,
            "pointCount": len(self.vertices),
            "elevationPointCount": self.elevation_point_count,
            "hasElevation": self.has_elevation,
            "distanceKm": self.distance_km,
            "ascentM": self.ascent_m,
            "descentM": self.descent_m,
            "coordinates": [list(vertex) for vertex in self.vertices],
        }


@dataclass(frozen=True)
class NormalizedLine:
    source_index: int
    source_kind: SourceKind
    name: str
    is_main: bool
    metadata: dict[str, Any]
    segments: list[NormalizedSegment]
    profile: Profile

    @property
    def distance_km(self) -> float:
        return sum(segment.distance_km for segment in self.segments)

    def to_json(self) -> dict[str, Any]:
        return {
            "sourceIndex": self.source_index,
            "sourceKind": self.source_kind,
            "name": self.name,
            "isMain": self.is_main,
            "sourceMetadata": self.metadata,
            "distanceKm": self.distance_km,
            "ascentM": self.profile.ascent_m,
            "descentM": self.profile.descent_m,
            "elevationComplete": self.profile.elevation_complete,
            "segments": [segment.to_json() for segment in self.segments],
            "profile": self.profile.to_json(),
        }


@dataclass
class ValidationReport:
    outcome: str
    source: dict[str, Any]
    summary: dict[str, Any]
    issues: list[Issue]
    options: dict[str, float]
    lines: list[dict[str, Any]] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "contractVersion": CONTRACT_VERSION,
            "processorVersion": PROCESSOR_VERSION,
            "outcome": self.outcome,
            "source": self.source,
            "options": self.options,
            "summary": self.summary,
            "lines": self.lines,
            "issues": [issue.to_json() for issue in self.issues],
        }


@dataclass(frozen=True)
class NormalizedImport:
    source_name: str | None
    lines: list[NormalizedLine]
    waypoints: list[RawWaypoint]
    report: ValidationReport

    @property
    def main_line(self) -> NormalizedLine:
        return next(line for line in self.lines if line.is_main)

    def to_json(self) -> dict[str, Any]:
        return {
            "contractVersion": CONTRACT_VERSION,
            "processorVersion": PROCESSOR_VERSION,
            "lines": [line.to_json() for line in self.lines],
            "waypoints": [_waypoint_json(index, waypoint) for index, waypoint in enumerate(self.waypoints)],
            "report": self.report.to_json(),
        }


def _waypoint_json(sequence: int, waypoint: RawWaypoint) -> dict[str, Any]:
    return {
        "sequence": sequence,
        "sourceIndex": waypoint.source_index,
        "name": waypoint.name,
        "description": waypoint.description,
        "comment": waypoint.comment,
        "symbol": waypoint.symbol,
        "sourceType": waypoint.source_type,
        "longitude": waypoint.lon,
        "latitude": waypoint.lat,
        "elevationM": waypoint.ele,
        "sourceMetadata": waypoint.metadata,
    }


class ImportFailedError(Exception):
    def __init__(self, report: ValidationReport) -> None:
        super().__init__("; ".join(issue.message for issue in report.issues if issue.severity == "error"))
        self.report = report


_KIND_LABEL: dict[SourceKind, str] = {"TRACK": "Track", "ROUTE": "Route", "LINE": "Line"}


def _dedupe(points: list[RawPoint]) -> tuple[list[RawPoint], list[int], int]:
    """Drops consecutive duplicates. Returns kept points, their source indices, and the count removed."""
    kept: list[RawPoint] = []
    indices: list[int] = []
    for index, point in enumerate(points):
        if kept and kept[-1].lon == point.lon and kept[-1].lat == point.lat:
            continue
        kept.append(point)
        indices.append(index)
    return kept, indices, len(points) - len(kept)


class _LineChecker:
    def __init__(self, line: RawLine, options: ImportOptions, collector: IssueCollector) -> None:
        self.line = line
        self.options = options
        self.collector = collector

    def location(self, part: int, point: int, km: float, p: RawPoint) -> Location:
        return Location(
            line_index=self.line.source_index, part_index=part, point_index=point, lon=p.lon, lat=p.lat, km=km
        )

    def check_part(
        self, part_index: int, points: list[RawPoint], source_indices: list[int], offset_km: float
    ) -> list[float]:
        """Reports spikes and gaps. Returns leg lengths in metres."""
        legs = [float(leg) for leg in leg_lengths_m([p.lon for p in points], [p.lat for p in points])]
        cumulative_km = [offset_km]
        for leg in legs:
            cumulative_km.append(cumulative_km[-1] + leg / 1000.0)

        spikes: set[int] = set()
        if self.line.kind != "ROUTE":
            for i in range(1, len(points) - 1):
                before, after = legs[i - 1], legs[i]
                direct = distance_m(
                    points[i - 1].lon, points[i - 1].lat, points[i + 1].lon, points[i + 1].lat
                )
                reason: str | None = None
                if min(before, after) >= SPIKE_MIN_LEG_M and before + after >= SPIKE_DETOUR_RATIO * max(
                    direct, 1.0
                ):
                    reason = "OUT_AND_BACK"
                if reason:
                    spikes.add(i)
                    self.collector.add(
                        Issue(
                            "GPS_SPIKE",
                            "warning",
                            "Possible GPS spike: the point jumps away from the line and back. It was kept.",
                            self.location(part_index, source_indices[i], cumulative_km[i], points[i]),
                            {"reason": reason, "legBeforeM": round(before, 1), "legAfterM": round(after, 1)},
                        )
                    )

        for j, leg in enumerate(legs):
            if j in spikes or (j + 1) in spikes:
                continue
            location = self.location(part_index, source_indices[j], cumulative_km[j], points[j])
            t0, t1 = points[j].time, points[j + 1].time
            if self.line.kind == "TRACK" and t0 is not None and t1 is not None and leg >= SPIKE_MIN_LEG_M:
                seconds = (t1 - t0).total_seconds()
                if seconds > 0 and leg / seconds > SPIKE_MAX_SPEED_MPS:
                    self.collector.add(
                        Issue(
                            "IMPLAUSIBLE_SPEED",
                            "warning",
                            f"The recording moves {leg:.0f} m in {seconds:.0f} s"
                            f" ({leg / seconds * 3.6:.0f} km/h) between these points.",
                            location,
                            {"lengthM": round(leg, 1), "seconds": seconds},
                        )
                    )
            details = {
                "lengthM": round(leg, 1),
                "toLon": points[j + 1].lon,
                "toLat": points[j + 1].lat,
                "toPointIndex": source_indices[j + 1],
            }
            if self.line.kind == "ROUTE":
                if leg > ROUTE_LONG_LEG_M:
                    self.collector.add(
                        Issue(
                            "ROUTE_LONG_LEG",
                            "info",
                            f"Route points are {leg / 1000:.2f} km apart. A planned route connects them"
                            " with a straight line; the actual path between them is not in the file.",
                            location,
                            details,
                        )
                    )
            elif leg > self.options.gap_fail_m:
                self.collector.add(
                    Issue(
                        "GAP_TOO_LARGE",
                        "error",
                        f"Consecutive points are {leg / 1000:.2f} km apart, more than the"
                        f" {self.options.gap_fail_m:g} m limit for a continuous segment.",
                        location,
                        details,
                    )
                )
            elif leg > self.options.gap_warn_m:
                self.collector.add(
                    Issue(
                        "LARGE_GAP",
                        "warning",
                        f"Consecutive points are {leg:.0f} m apart."
                        " The line is drawn straight across the gap.",
                        location,
                        details,
                    )
                )
        return legs


def normalize(parsed: ParsedSource, options: ImportOptions | None = None) -> NormalizedImport:
    options = options or ImportOptions()
    collector = IssueCollector()
    for issue in parsed.issues:
        collector.add(issue)

    points_read = sum(len(part) for line in parsed.lines for part in line.parts)
    source = {"format": parsed.format, "crs": parsed.crs.to_json(), "metadata": parsed.metadata}

    def fail(summary: dict[str, Any]) -> ImportFailedError:
        return ImportFailedError(
            ValidationReport("FAILED", source, summary, collector.finish(), options.to_json())
        )

    if points_read > MAX_POINTS:
        collector.add(
            Issue(
                "TOO_MANY_POINTS",
                "error",
                f"The file has {points_read} points; at most {MAX_POINTS} are supported.",
                details={"points": points_read, "limit": MAX_POINTS},
            )
        )
        raise fail({"pointsRead": points_read})

    if collector.has_errors:
        # Report what the parser found; downstream checks on broken input only add noise.
        raise fail({"pointsRead": points_read})

    built: list[tuple[RawLine, list[NormalizedSegment], Profile]] = []
    duplicates_removed = 0
    for line in parsed.lines:
        checker = _LineChecker(line, options, collector)
        kept_parts: list[tuple[int, list[RawPoint], list[int]]] = []
        for part_index, points in enumerate(line.parts):
            kept, indices, removed = _dedupe(points)
            duplicates_removed += removed
            if removed:
                collector.add(
                    Issue(
                        "DUPLICATE_POINTS_REMOVED",
                        "info",
                        f"{removed} consecutive duplicate point(s) removed.",
                        Location(line_index=line.source_index, part_index=part_index),
                        {"removed": removed},
                    )
                )
            if len(kept) < 2:
                collector.add(
                    Issue(
                        "SEGMENT_TOO_SHORT",
                        "warning",
                        "A segment with fewer than two distinct points was skipped.",
                        Location(line_index=line.source_index, part_index=part_index),
                        {"distinctPoints": len(kept)},
                    )
                )
                continue
            kept_parts.append((part_index, kept, indices))

        if not kept_parts:
            collector.add(
                Issue(
                    "LINE_SKIPPED",
                    "warning",
                    f"{_KIND_LABEL[line.kind]} has no usable segment and was skipped.",
                    Location(line_index=line.source_index),
                )
            )
            continue

        offset_km = 0.0
        legs_by_part: list[list[float]] = []
        for position, (part_index, kept, indices) in enumerate(kept_parts):
            if position > 0:
                previous = kept_parts[position - 1][1][-1]
                first = kept[0]
                separation = distance_m(previous.lon, previous.lat, first.lon, first.lat)
                collector.add(
                    Issue(
                        "SEGMENT_DISCONTINUITY",
                        "warning" if separation > options.gap_warn_m else "info",
                        f"Separate source segments, {separation:.0f} m apart. They are kept separate and the"
                        " distance between them is not counted.",
                        Location(
                            line_index=line.source_index,
                            part_index=part_index,
                            lon=first.lon,
                            lat=first.lat,
                            km=offset_km,
                        ),
                        {
                            "separationM": round(separation, 1),
                            "fromLon": previous.lon,
                            "fromLat": previous.lat,
                        },
                    )
                )
            legs = checker.check_part(part_index, kept, indices, offset_km)
            legs_by_part.append(legs)
            offset_km += sum(legs) / 1000.0

        vertices_by_part: list[list[Vertex]] = []
        elevation_counts: list[int] = []
        for _, kept, _ in kept_parts:
            with_ele = sum(1 for p in kept if p.ele is not None)
            elevation_counts.append(with_ele)
            if with_ele == len(kept):
                vertices_by_part.append([(p.lon, p.lat, p.ele) for p in kept if p.ele is not None])
            else:
                vertices_by_part.append([(p.lon, p.lat) for p in kept])

        profile, part_profiles = build_profile(vertices_by_part)
        segments = [
            NormalizedSegment(
                source_part_index=part_index,
                vertices=vertices,
                elevation_point_count=elevation_count,
                distance_km=sum(legs) / 1000.0,
                ascent_m=part_profile.ascent_m,
                descent_m=part_profile.descent_m,
            )
            for (part_index, _, _), vertices, elevation_count, legs, part_profile in zip(
                kept_parts, vertices_by_part, elevation_counts, legs_by_part, part_profiles, strict=True
            )
        ]

        total_points = sum(len(kept) for _, kept, _ in kept_parts)
        total_with_ele = sum(elevation_counts)
        if total_with_ele == 0:
            collector.add(
                Issue(
                    "ELEVATION_MISSING",
                    "info",
                    "No elevation in the source. The elevation profile is unavailable.",
                    Location(line_index=line.source_index),
                )
            )
        elif total_with_ele < total_points:
            collector.add(
                Issue(
                    "ELEVATION_INCOMPLETE",
                    "warning",
                    f"{total_points - total_with_ele} of {total_points} points have no valid elevation."
                    " Missing values are not filled in, so the elevation profile is unavailable.",
                    Location(line_index=line.source_index),
                    {"pointsWithElevation": total_with_ele, "points": total_points},
                )
            )
        built.append((line, segments, profile))

    if not built:
        collector.add(
            Issue(
                "NO_ROUTE_GEOMETRY",
                "error",
                "The file contains no track, route or line with at least two distinct points.",
            )
        )
    summary = {
        "lines": {
            kind: sum(1 for line, _, _ in built if line.kind == kind) for kind in ("TRACK", "ROUTE", "LINE")
        },
        "segments": sum(len(segments) for _, segments, _ in built),
        "waypoints": len(parsed.waypoints),
        "pointsRead": points_read,
        "pointsKept": sum(len(segment.vertices) for _, segments, _ in built for segment in segments),
        "duplicatesRemoved": duplicates_removed,
    }
    if collector.has_errors:
        raise fail(summary)

    main_index = _main_index([line.kind for line, _, _ in built])
    lines = [
        NormalizedLine(
            source_index=line.source_index,
            source_kind=line.kind,
            name=line.name or f"{_KIND_LABEL[line.kind]} {line.source_index + 1}",
            is_main=index == main_index,
            metadata=line.metadata,
            segments=segments,
            profile=profile,
        )
        for index, (line, segments, profile) in enumerate(built)
    ]
    report = ValidationReport(
        "SUCCEEDED",
        source,
        summary,
        collector.finish(),
        options.to_json(),
        lines=[
            {
                "lineIndex": line.source_index,
                "sourceKind": line.source_kind,
                "name": line.name,
                "isMain": line.is_main,
                "distanceKm": line.distance_km,
                "segments": len(line.segments),
                "elevationComplete": line.profile.elevation_complete,
                "ascentM": line.profile.ascent_m,
                "descentM": line.profile.descent_m,
            }
            for line in lines
        ],
    )
    return NormalizedImport(source_name=parsed.name, lines=lines, waypoints=parsed.waypoints, report=report)


def _main_index(kinds: list[SourceKind]) -> int:
    """The main variant is the first track, else the first route, else the first line."""
    for wanted in ("TRACK", "ROUTE", "LINE"):
        for index, kind in enumerate(kinds):
            if kind == wanted:
                return index
    return 0
