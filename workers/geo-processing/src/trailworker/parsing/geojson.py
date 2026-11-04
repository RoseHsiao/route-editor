"""GeoJSON parsing (RFC 7946), with explicit, documented support for legacy CRS members.

Coordinate reference systems:

- RFC 7946 removed the `crs` member. Without one, positions are WGS 84 [longitude, latitude].
- Legacy files (GeoJSON 2008) may name a CRS on the top-level object:
  `{"type": "name", "properties": {"name": "<urn or EPSG:code>"}}`, or the older
  `{"type": "EPSG", "properties": {"code": <int>}}`.
  - OGC CRS84 and EPSG:4326 are accepted as WGS 84 without reprojection.
  - Any other EPSG code that PROJ knows and that is a 2D geographic or projected CRS is
    reprojected to WGS 84 with pyproj. Source and target CRS are recorded.
  - Anything else (unknown codes, `link` CRSs, compound/vertical/geocentric CRSs, a `crs`
    on a nested object) is a structured UNSUPPORTED_CRS error.
- Positions are always read as x, y[, z] (easting/longitude first), as both GeoJSON
  specifications require, even for EPSG:4326. Axes are never swapped automatically.
- A third value is kept as elevation in metres, unchanged by reprojection.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, replace
from typing import Any

from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError

from ..contract import MAX_METADATA_BYTES, WGS84_LONLAT, CrsInfo, Issue, Location
from .types import (
    IssueCollector,
    ParsedSource,
    ParseFailedError,
    RawLine,
    RawPoint,
    RawWaypoint,
    check_coordinate,
    check_elevation,
)

_WGS84_NAMES = {
    "urn:ogc:def:crs:ogc:1.3:crs84",
    "urn:ogc:def:crs:ogc::crs84",
    "ogc:crs84",
    "crs84",
    "http://www.opengis.net/def/crs/ogc/1.3/crs84",
}
_EPSG_NAME = re.compile(
    r"^(?:epsg:|urn:ogc:def:crs:epsg:[0-9.]*:|http://www\.opengis\.net/def/crs/epsg/[0-9.]+/)(\d+)$"
)
_LINE_TYPES = {"LineString", "MultiLineString"}
_POINT_TYPES = {"Point", "MultiPoint"}
_KNOWN_GEOMETRY_TYPES = _LINE_TYPES | _POINT_TYPES | {"Polygon", "MultiPolygon", "GeometryCollection"}


def _fail(code: str, message: str, **details: Any) -> ParseFailedError:
    return ParseFailedError([Issue(code, "error", message, details=details)])


@dataclass
class _Projection:
    info: CrsInfo
    transformer: Transformer | None

    def apply(self, x: float, y: float) -> tuple[float, float]:
        if self.transformer is None:
            return x, y
        lon, lat = self.transformer.transform(x, y)
        return float(lon), float(lat)


def _resolve_crs(document: dict[str, Any]) -> _Projection:
    wgs84 = _Projection(CrsInfo(None, WGS84_LONLAT, WGS84_LONLAT, reprojected=False), None)
    if "crs" not in document or document["crs"] is None:
        return wgs84

    crs = document["crs"]
    declared: str
    code: int | None = None
    if isinstance(crs, dict) and crs.get("type") == "name" and isinstance(crs.get("properties"), dict):
        name = crs["properties"].get("name")
        if not isinstance(name, str) or not name.strip():
            raise _fail("UNSUPPORTED_CRS", "The crs member names no coordinate reference system.")
        declared = name.strip()
        normalized = declared.lower()
        if normalized in _WGS84_NAMES:
            return _Projection(CrsInfo(declared, WGS84_LONLAT, WGS84_LONLAT, reprojected=False), None)
        match = _EPSG_NAME.match(normalized)
        if match is None:
            raise _fail(
                "UNSUPPORTED_CRS", f"Coordinate reference system {declared!r} is not supported.", crs=declared
            )
        code = int(match.group(1))
    elif isinstance(crs, dict) and crs.get("type") == "EPSG" and isinstance(crs.get("properties"), dict):
        raw_code = crs["properties"].get("code")
        if not isinstance(raw_code, int) or isinstance(raw_code, bool):
            raise _fail("UNSUPPORTED_CRS", "The EPSG crs member has no integer code.")
        code = raw_code
        declared = f"EPSG:{code}"
    else:
        kind = crs.get("type") if isinstance(crs, dict) else type(crs).__name__
        raise _fail(
            "UNSUPPORTED_CRS",
            f"Only named (legacy GeoJSON) CRS members are supported, not {kind!r}.",
            crsType=str(kind),
        )

    if code == 4326:
        return _Projection(CrsInfo(declared, "EPSG:4326", WGS84_LONLAT, reprojected=False), None)
    try:
        source = CRS.from_epsg(code)
    except CRSError as error:
        raise _fail(
            "UNSUPPORTED_CRS", f"Coordinate reference system EPSG:{code} is unknown.", crs=declared
        ) from error
    if not (source.is_geographic or source.is_projected) or len(source.axis_info) != 2:
        raise _fail(
            "UNSUPPORTED_CRS",
            f"EPSG:{code} ({source.name}) is not a two-dimensional geographic or projected system.",
            crs=declared,
        )
    transformer = Transformer.from_crs(source, CRS.from_user_input(WGS84_LONLAT), always_xy=True)
    return _Projection(CrsInfo(declared, f"EPSG:{code}", WGS84_LONLAT, reprojected=True), transformer)


def _find_nested_crs(value: Any, path: str = "") -> str | None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "crs" and path:
                return path
            if key in ("properties",):
                continue
            found = _find_nested_crs(child, f"{path}.{key}" if path else key)
            if found:
                return found
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found = _find_nested_crs(child, f"{path}[{index}]")
            if found:
                return found
    return None


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


class _Reader:
    def __init__(self, projection: _Projection) -> None:
        self.projection = projection
        self.collector = IssueCollector()
        self.lines: list[RawLine] = []
        self.waypoints: list[RawWaypoint] = []
        self.extra_values = 0

    def position(self, raw: Any, location: Location) -> RawPoint | None:
        if not isinstance(raw, list) or len(raw) < 2:
            self.collector.add(
                Issue(
                    "INVALID_COORDINATE",
                    "error",
                    "A position must be an array of at least two numbers.",
                    location,
                )
            )
            return None
        x, y = _number(raw[0]), _number(raw[1])
        if x is None or y is None or not (math.isfinite(x) and math.isfinite(y)):
            self.collector.add(
                Issue("INVALID_COORDINATE", "error", "Coordinates must be finite numbers.", location)
            )
            return None
        if len(raw) > 3:
            self.extra_values += 1
        lon, lat = self.projection.apply(x, y)
        if not check_coordinate(
            lon, lat, location, self.collector, axis_hint=self.projection.transformer is None
        ):
            return None
        ele_raw: Any = raw[2] if len(raw) >= 3 else None
        ele_value: float | str | None
        if ele_raw is None:
            ele_value = None
        elif (number := _number(ele_raw)) is not None:
            ele_value = number
        else:
            ele_value = str(ele_raw)
        location = replace(location, lon=lon, lat=lat)
        ele = check_elevation(ele_value, location, self.collector)
        return RawPoint(lon=lon, lat=lat, ele=ele)

    def positions(self, raw: Any, location: Location) -> list[RawPoint]:
        if not isinstance(raw, list):
            self.collector.add(Issue("INVALID_GEOMETRY", "error", "Coordinates must be an array.", location))
            return []
        points = []
        for index, item in enumerate(raw):
            point = self.position(item, replace(location, point_index=index))
            if point is not None:
                points.append(point)
        return points

    def geometry(self, geometry: Any, feature_index: int, name: str | None, metadata: dict[str, Any]) -> None:
        location = Location(feature_index=feature_index)
        if geometry is None:
            self.collector.add(
                Issue("EMPTY_GEOMETRY", "warning", "Feature without geometry skipped.", location)
            )
            return
        if not isinstance(geometry, dict) or not isinstance(geometry.get("type"), str):
            self.collector.add(Issue("INVALID_GEOMETRY", "error", "Geometry object has no type.", location))
            return
        kind = geometry["type"]
        if kind == "GeometryCollection":
            members = geometry.get("geometries")
            if not isinstance(members, list):
                self.collector.add(
                    Issue(
                        "INVALID_GEOMETRY", "error", "GeometryCollection has no geometries array.", location
                    )
                )
                return
            for member in members:
                self.geometry(member, feature_index, name, metadata)
            return
        if kind not in _KNOWN_GEOMETRY_TYPES:
            self.collector.add(
                Issue("INVALID_GEOMETRY", "error", f"{kind!r} is not a GeoJSON geometry type.", location)
            )
            return
        if kind in ("Polygon", "MultiPolygon"):
            self.collector.add(
                Issue(
                    "UNSUPPORTED_GEOMETRY",
                    "warning",
                    f"{kind} geometries are not routes and were skipped.",
                    location,
                    {"geometryType": kind},
                )
            )
            return

        coordinates = geometry.get("coordinates")
        if kind in _LINE_TYPES:
            line_index = len(self.lines)
            base = Location(line_index=line_index, feature_index=feature_index)
            if kind == "LineString":
                parts = [self.positions(coordinates, replace(base, part_index=0))]
            elif isinstance(coordinates, list):
                parts = [
                    self.positions(part, replace(base, part_index=part_index))
                    for part_index, part in enumerate(coordinates)
                ]
            else:
                self.collector.add(Issue("INVALID_GEOMETRY", "error", "Coordinates must be an array.", base))
                return
            self.lines.append(
                RawLine(
                    kind="LINE",
                    source_index=line_index,
                    name=name,
                    metadata={**metadata, "featureIndex": feature_index, "geometryType": kind},
                    parts=parts,
                )
            )
            return

        # Points become standalone waypoints.
        point_lists = [coordinates] if kind == "Point" else coordinates
        if not isinstance(point_lists, list):
            self.collector.add(Issue("INVALID_GEOMETRY", "error", "Coordinates must be an array.", location))
            return
        for raw in point_lists:
            waypoint_index = len(self.waypoints)
            point_location = Location(waypoint_index=waypoint_index, feature_index=feature_index)
            check = IssueCollector()
            saved, self.collector = self.collector, check
            point = self.position(raw, point_location)
            self.collector = saved
            for issue in check.issues:
                self.collector.add(
                    Issue(
                        issue.code,
                        "warning",
                        f"Waypoint skipped: {issue.message}",
                        issue.location,
                        issue.details,
                    )
                    if issue.code == "INVALID_COORDINATE"
                    else issue
                )
            if point is None:
                continue
            self.waypoints.append(
                RawWaypoint(
                    source_index=waypoint_index,
                    lon=point.lon,
                    lat=point.lat,
                    ele=point.ele,
                    name=name,
                    description=_string(metadata.get("description") or metadata.get("desc")),
                    metadata={**metadata, "featureIndex": feature_index},
                )
            )


def _string(value: Any) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _properties(raw: Any, feature_index: int, collector: IssueCollector) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    encoded = json.dumps(raw, ensure_ascii=False, sort_keys=True)
    if len(encoded.encode()) > MAX_METADATA_BYTES:
        collector.add(
            Issue(
                "METADATA_TRUNCATED",
                "info",
                f"Feature properties larger than {MAX_METADATA_BYTES // 1024} KB were not kept.",
                Location(feature_index=feature_index),
            )
        )
        return {"propertiesOmitted": True}
    return {"properties": raw}


def parse_geojson(data: bytes) -> ParsedSource:
    try:
        document = json.loads(data.decode("utf-8-sig"))
    except UnicodeDecodeError as error:
        raise _fail("INVALID_ENCODING", "GeoJSON must be UTF-8 encoded.") from error
    except json.JSONDecodeError as error:
        raise _fail(
            "MALFORMED_JSON", "The file is not valid JSON.", line=error.lineno, column=error.colno
        ) from error

    if not isinstance(document, dict) or not isinstance(document.get("type"), str):
        raise _fail("NOT_GEOJSON", "Expected a GeoJSON object with a type member.")

    nested = _find_nested_crs({key: value for key, value in document.items() if key != "crs"})
    if nested:
        raise _fail(
            "UNSUPPORTED_CRS",
            "A crs member is only supported on the top-level object.",
            path=nested,
        )
    projection = _resolve_crs(document)
    reader = _Reader(projection)

    kind = document["type"]
    if kind == "FeatureCollection":
        features = document.get("features")
        if not isinstance(features, list):
            raise _fail("NOT_GEOJSON", "FeatureCollection has no features array.")
    elif kind == "Feature":
        features = [document]
    elif kind in _KNOWN_GEOMETRY_TYPES:
        features = [{"type": "Feature", "geometry": document, "properties": None}]
    else:
        raise _fail("NOT_GEOJSON", f"{kind!r} is not a GeoJSON object type.")

    for feature_index, feature in enumerate(features):
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            reader.collector.add(
                Issue(
                    "INVALID_GEOMETRY", "error", "Expected a Feature.", Location(feature_index=feature_index)
                )
            )
            continue
        props = feature.get("properties")
        name = _string(props.get("name")) or _string(props.get("title")) if isinstance(props, dict) else None
        metadata = _properties(props, feature_index, reader.collector)
        reader.geometry(feature.get("geometry"), feature_index, name, metadata)

    if reader.extra_values:
        reader.collector.add(
            Issue(
                "EXTRA_COORDINATE_VALUES",
                "info",
                "Values after the third in a position were ignored.",
                details={"positions": reader.extra_values},
            )
        )
    if projection.info.reprojected:
        reader.collector.add(
            Issue(
                "CRS_REPROJECTED",
                "info",
                f"Coordinates were reprojected from {projection.info.source} to WGS 84"
                " (legacy GeoJSON crs member).",
                details=projection.info.to_json(),
            )
        )

    collection_name = _string(document.get("name"))
    return ParsedSource(
        format="GEOJSON",
        crs=projection.info,
        name=collection_name,
        metadata={"name": collection_name} if collection_name else {},
        lines=reader.lines,
        waypoints=reader.waypoints,
        issues=reader.collector.finish(),
    )
