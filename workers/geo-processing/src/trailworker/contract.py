"""Geo processing contract, version 1.

The JSON shapes the worker produces (normalized import, profile, validation report,
job errors) are specified by the JSON Schemas in `contracts/geo/v1/` at the repository
root and read by the web app through `lib/import/contract.ts`. Field names are camelCase
because the JSON is stored in Postgres and consumed by TypeScript.

Constants here mirror `contracts/geo/v1/constants.json`; `tests/test_contract.py`
fails if they drift apart.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

CONTRACT_VERSION = 1
PROFILE_SCHEMA_VERSION = 1

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_POINTS = 1_000_000
MAX_ISSUES_PER_CODE = 20
MAX_METADATA_BYTES = 16 * 1024

DEFAULT_GAP_WARN_M = 100.0
DEFAULT_GAP_FAIL_M = 1000.0
ROUTE_LONG_LEG_M = 1000.0
SPIKE_MIN_LEG_M = 50.0
SPIKE_DETOUR_RATIO = 4.0
SPIKE_MAX_SPEED_MPS = 60.0
ELEVATION_MIN_M = -500.0
ELEVATION_MAX_M = 9000.0

PROFILE_SAMPLE_SPACING_M = 25.0
PROFILE_SMOOTHING_WINDOW = 7

Severity = Literal["error", "warning", "info"]
SourceKind = Literal["TRACK", "ROUTE", "LINE"]
SourceFormat = Literal["GPX", "GEOJSON"]


@dataclass(frozen=True)
class Location:
    """Where an issue is. Indices are 0-based positions in the source file."""

    line_index: int | None = None
    part_index: int | None = None
    point_index: int | None = None
    waypoint_index: int | None = None
    feature_index: int | None = None
    lon: float | None = None
    lat: float | None = None
    km: float | None = None

    def to_json(self) -> dict[str, Any]:
        names = {
            "line_index": "lineIndex",
            "part_index": "partIndex",
            "point_index": "pointIndex",
            "waypoint_index": "waypointIndex",
            "feature_index": "featureIndex",
            "lon": "lon",
            "lat": "lat",
            "km": "km",
        }
        return {
            json_name: getattr(self, name)
            for name, json_name in names.items()
            if getattr(self, name) is not None
        }


@dataclass(frozen=True)
class Issue:
    """One finding of the validation report. `code` is stable; `message` is for people."""

    code: str
    severity: Severity
    message: str
    location: Location | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity,
            "message": self.message,
            "location": self.location.to_json() if self.location else None,
            "details": self.details,
        }


@dataclass(frozen=True)
class CrsInfo:
    """How coordinates were interpreted. RFC 7946 GeoJSON and GPX are always WGS 84 lon/lat."""

    declared: str | None
    source: str
    target: str
    reprojected: bool

    def to_json(self) -> dict[str, Any]:
        return {
            "declared": self.declared,
            "source": self.source,
            "target": self.target,
            "reprojected": self.reprojected,
        }


WGS84_LONLAT = "OGC:CRS84"
