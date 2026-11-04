"""Writes the synthetic import fixtures in fixtures/synthetic/. Deterministic; CC0-1.0.

    uv run python scripts/generate_fixtures.py

Every fixture is generated from simple geometry with known properties (length, ascent),
labelled SYNTHETIC, and does not depict a real trail.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from pyproj import Geod, Transformer

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "fixtures" / "synthetic"
GEOD = Geod(ellps="WGS84")
START = (6.85, 45.80)
T0 = datetime(2026, 7, 1, 6, 0, tzinfo=UTC)
LABEL = "SYNTHETIC RouteEditor fixture (CC0-1.0). Not a real trail."

Point = tuple[float, float, float | str | None, datetime | None]


def walk(
    start: tuple[float, float], azimuth: float, count: int, spacing_m: float
) -> list[tuple[float, float]]:
    """count points along a geodesic, spacing_m apart."""
    points = [start]
    lon, lat = start
    for _ in range(count - 1):
        lon, lat, _ = GEOD.fwd(lon, lat, azimuth, spacing_m)
        points.append((round(lon, 9), round(lat, 9)))
    return points


def offset(point: tuple[float, float], azimuth: float, distance_m: float) -> tuple[float, float]:
    lon, lat, _ = GEOD.fwd(point[0], point[1], azimuth, distance_m)
    return round(lon, 9), round(lat, 9)


def triangle_elevation(index: int, spacing_m: float) -> float:
    """1000 m at 0 km, rising to 1600 m at 6 km, falling to 1200 m at 10 km."""
    distance = index * spacing_m
    if distance <= 6000:
        return round(1000 + distance * 0.1, 3)
    return round(1600 - (distance - 6000) * 0.1, 3)


def gpx_point(tag: str, point: Point, extra: str = "") -> str:
    lon, lat, ele, time = point
    children = ""
    if ele is not None:
        children += f"<ele>{ele}</ele>"
    if time is not None:
        children += f"<time>{time.strftime('%Y-%m-%dT%H:%M:%SZ')}</time>"
    return f'      <{tag} lat="{lat}" lon="{lon}">{children}{extra}</{tag}>\n'


def gpx_document(name: str, body: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<gpx version="1.1" creator="RouteEditor fixture generator" xmlns="http://www.topografix.com/GPX/1/1">\n'
        f"  <metadata><name>{escape(name)}</name><desc>{escape(LABEL)}</desc></metadata>\n"
        f"{body}</gpx>\n"
    )


def track(name: str, segments: list[list[Point]]) -> str:
    body = f"  <trk>\n    <name>{escape(name)}</name>\n    <type>hiking</type>\n"
    for segment in segments:
        body += "    <trkseg>\n" + "".join(gpx_point("trkpt", p) for p in segment) + "    </trkseg>\n"
    return body + "  </trk>\n"


def timed(
    points: list[tuple[float, float]], elevations: list[float | str | None], seconds: int = 20
) -> list[Point]:
    return [
        (lon, lat, ele, T0 + timedelta(seconds=i * seconds))
        for i, ((lon, lat), ele) in enumerate(zip(points, elevations, strict=True))
    ]


def track_basic() -> str:
    points = walk(START, 0.0, 401, 25.0)
    return gpx_document(
        "SYNTHETIC Basic track",
        track("Basic track", [timed(points, [triangle_elevation(i, 25.0) for i in range(401)])]),
    )


def mixed() -> str:
    seg1 = walk(START, 0.0, 81, 25.0)
    seg2 = walk(offset(seg1[-1], 0.0, 1500.0), 0.0, 81, 25.0)
    route = walk(offset(START, 90.0, 500.0), 0.0, 5, 1200.0)
    waypoints = [
        (offset(START, 90.0, 100.0), 1012.5, "Synthetic spring", "Water source", "Drinking Water", "water"),
        (offset(seg1[-1], 90.0, 50.0), 1180.0, "Synthetic hut", None, "Lodging", "hut"),
        (offset(seg2[-1], 270.0, 80.0), None, "Synthetic viewpoint", "No elevation in source", None, None),
    ]
    body = ""
    for (lon, lat), ele, wpt_name, desc, sym, kind in waypoints:
        extra = f"<name>{escape(wpt_name)}</name>"
        extra += f"<desc>{escape(desc)}</desc>" if desc else ""
        extra += f"<sym>{escape(sym)}</sym>" if sym else ""
        extra += f"<type>{escape(kind)}</type>" if kind else ""
        body += gpx_point("wpt", (lon, lat, ele, None), extra).replace("      ", "  ", 1)
    body += "  <rte>\n    <name>Planned route</name>\n    <desc>Sparse planned route points</desc>\n"
    body += "".join(
        gpx_point("rtept", (lon, lat, 1000.0 + 50 * i, None)) for i, (lon, lat) in enumerate(route)
    )
    body += "  </rte>\n"
    body += track(
        "Recorded track",
        [
            timed(seg1, [1000.0 + i * 2 for i in range(81)]),
            [
                (lon, lat, 1300.0 - i, T0 + timedelta(hours=2, seconds=i * 20))
                for i, (lon, lat) in enumerate(seg2)
            ],
        ],
    )
    return gpx_document("SYNTHETIC Mixed tracks, routes and waypoints", body)


def quality_issues() -> str:
    base = walk(START, 0.0, 201, 25.0)
    points: list[Point] = []
    for i, (lon, lat) in enumerate(base):
        ele: float | str | None = 1000.0 + i
        if i in (150, 151, 152):
            ele = None
        elif i == 160:
            ele = "abc"
        elif i == 161:
            ele = 99999.0
        if i == 50:
            lon, lat = offset((lon, lat), 90.0, 400.0)
        if i > 120:
            lon, lat = offset((lon, lat), 0.0, 300.0)
        points.append((lon, lat, ele, T0 + timedelta(seconds=i * 20)))
        if i == 10:
            points.append((lon, lat, ele, T0 + timedelta(seconds=i * 20 + 5)))
    return gpx_document("SYNTHETIC Track with data-quality issues", track("Quality issues", [points]))


def large_gap() -> str:
    first = walk(START, 0.0, 41, 25.0)
    second = walk(offset(first[-1], 0.0, 2000.0), 0.0, 41, 25.0)
    points = timed(first + second, [1000.0] * 82)
    return gpx_document("SYNTHETIC Track with a 2 km gap", track("Large gap", [points]))


def invalid_coordinates() -> str:
    points = timed(walk(START, 0.0, 5, 25.0), [1000.0] * 5)
    points[2] = (6.85, 95.1, 1000.0, points[2][3])
    return gpx_document("SYNTHETIC Invalid coordinate", track("Invalid", [points]))


def no_elevation() -> str:
    points = [(lon, lat, None, None) for lon, lat in walk(START, 45.0, 101, 25.0)]
    return gpx_document("SYNTHETIC Track without elevation", track("Flat recording", [points]))


def malformed() -> str:
    return gpx_document(
        "SYNTHETIC Malformed", track("Broken", [timed(walk(START, 0.0, 3, 25.0), [1.0] * 3)])
    )[:-40]


def unsafe_entity() -> str:
    return (
        '<?xml version="1.0"?>\n<!DOCTYPE gpx [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]>\n'
        '<gpx version="1.1" creator="RouteEditor fixture generator" xmlns="http://www.topografix.com/GPX/1/1">'
        "<metadata><name>&b;</name></metadata></gpx>\n"
    )


def feature(geometry: dict[str, Any] | None, name: str | None, **properties: Any) -> dict[str, Any]:
    props = {"name": name, **properties} if name else properties or None
    return {"type": "Feature", "properties": props, "geometry": geometry}


def collection(features: list[dict[str, Any]], **extra: Any) -> str:
    return (
        json.dumps({"type": "FeatureCollection", "name": LABEL, **extra, "features": features}, indent=1)
        + "\n"
    )


def lines_wgs84() -> str:
    ridge = walk(START, 30.0, 121, 25.0)
    part1 = walk(offset(START, 180.0, 2000.0), 90.0, 41, 25.0)
    part2 = walk(offset(part1[-1], 90.0, 200.0), 90.0, 41, 25.0)
    return collection(
        [
            feature(
                {
                    "type": "LineString",
                    "coordinates": [[lon, lat, 1500.0 + i * 1.5] for i, (lon, lat) in enumerate(ridge)],
                },
                "Ridge line",
                surface="synthetic",
            ),
            feature(
                {
                    "type": "MultiLineString",
                    "coordinates": [[list(p) for p in part1], [list(p) for p in part2]],
                },
                "Two-part line",
            ),
            feature(
                {"type": "Point", "coordinates": [*offset(START, 30.0, 1500.0), 1650.0]}, "Synthetic col"
            ),
            feature(
                {
                    "type": "Polygon",
                    "coordinates": [[[6.84, 45.79], [6.86, 45.79], [6.86, 45.81], [6.84, 45.79]]],
                },
                "Synthetic area",
            ),
        ]
    )


def line_epsg2056() -> str:
    to_lv95 = Transformer.from_crs("EPSG:4326", "EPSG:2056", always_xy=True)
    points = walk((7.45, 46.95), 60.0, 81, 25.0)
    coordinates = []
    for i, (lon, lat) in enumerate(points):
        x, y = to_lv95.transform(lon, lat)
        coordinates.append([round(x, 3), round(y, 3), 550.0 + i * 0.5])
    return collection(
        [feature({"type": "LineString", "coordinates": coordinates}, "Projected line")],
        crs={"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::2056"}},
    )


def unknown_crs() -> str:
    return collection(
        [feature({"type": "LineString", "coordinates": [[1.0, 2.0], [3.0, 4.0]]}, "Unknown CRS")],
        crs={"type": "name", "properties": {"name": "EPSG:999999"}},
    )


def swapped_axes() -> str:
    points = walk((120.5, 30.2), 0.0, 5, 25.0)
    return collection(
        [feature({"type": "LineString", "coordinates": [[lat, lon] for lon, lat in points]}, "Swapped")]
    )


def unsupported_only() -> str:
    return collection(
        [
            feature(
                {
                    "type": "Polygon",
                    "coordinates": [[[6.84, 45.79], [6.86, 45.79], [6.86, 45.81], [6.84, 45.79]]],
                },
                "Area only",
            )
        ]
    )


FIXTURES = {
    "track-basic.gpx": track_basic,
    "mixed-trk-rte-wpt.gpx": mixed,
    "track-quality-issues.gpx": quality_issues,
    "track-large-gap.gpx": large_gap,
    "track-no-elevation.gpx": no_elevation,
    "invalid-coordinates.gpx": invalid_coordinates,
    "malformed.gpx": malformed,
    "unsafe-entity.gpx": unsafe_entity,
    "lines-wgs84.geojson": lines_wgs84,
    "line-epsg2056.geojson": line_epsg2056,
    "unknown-crs.geojson": unknown_crs,
    "swapped-axes.geojson": swapped_axes,
    "unsupported-only.geojson": unsupported_only,
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, build in FIXTURES.items():
        (OUT / name).write_text(build(), encoding="utf-8")
        print(f"wrote fixtures/synthetic/{name}")


if __name__ == "__main__":
    main()
