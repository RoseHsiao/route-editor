"""GPX 1.0 / 1.1 parsing. <trk>, <rte> and <wpt> are read independently.

XML is parsed with defusedxml, which rejects DTDs, entity expansion and external
references. Extensions are ignored. Coordinates are WGS 84 by definition of GPX.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import replace
from datetime import datetime
from typing import Any

import defusedxml.ElementTree as SafeET
from defusedxml import DefusedXmlException

from ..contract import WGS84_LONLAT, CrsInfo, Issue, Location, SourceKind
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

_TEXT_FIELDS = ("name", "cmt", "desc", "src", "type", "number")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element if _local(child.tag) == name]


def _text(element: ET.Element, name: str) -> str | None:
    for child in element:
        if _local(child.tag) == name:
            value = (child.text or "").strip()
            return value or None
    return None


def _links(element: ET.Element) -> list[str]:
    hrefs = [link.get("href") for link in _children(element, "link")]
    # GPX 1.0 uses <url>.
    hrefs += [_text(element, "url")]
    return [href for href in hrefs if href]


def _metadata(element: ET.Element) -> dict[str, Any]:
    result: dict[str, Any] = {
        key: value for key in _TEXT_FIELDS if (value := _text(element, key)) is not None
    }
    links = _links(element)
    if links:
        result["links"] = links
    return result


def _time(element: ET.Element) -> datetime | None:
    raw = _text(element, "time")
    if raw is None:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def _float_attr(element: ET.Element, name: str) -> float | None:
    raw = element.get(name)
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _point(element: ET.Element, location: Location, collector: IssueCollector) -> RawPoint | None:
    lon, lat = _float_attr(element, "lon"), _float_attr(element, "lat")
    if not check_coordinate(lon, lat, location, collector, axis_hint=False):
        return None
    assert lon is not None and lat is not None  # noqa: S101 - narrowed by check_coordinate
    location = replace(location, lon=lon, lat=lat)
    return RawPoint(
        lon=lon, lat=lat, ele=check_elevation(_text(element, "ele"), location, collector), time=_time(element)
    )


def parse_gpx(data: bytes) -> ParsedSource:
    try:
        root = SafeET.fromstring(data)
    except DefusedXmlException as error:
        raise ParseFailedError(
            [
                Issue(
                    "UNSAFE_XML",
                    "error",
                    "The file uses XML features that are not accepted (DTDs or entities).",
                )
            ]
        ) from error
    except ET.ParseError as error:
        line, column = getattr(error, "position", (None, None))
        raise ParseFailedError(
            [
                Issue(
                    "MALFORMED_XML",
                    "error",
                    "The file is not well-formed XML.",
                    details={"line": line, "column": column},
                )
            ]
        ) from error

    if _local(root.tag) != "gpx":
        raise ParseFailedError(
            [Issue("NOT_GPX", "error", f"Expected a <gpx> root element, found <{_local(root.tag)}>.")]
        )

    collector = IssueCollector()
    metadata_element = next(iter(_children(root, "metadata")), None)
    metadata: dict[str, Any] = {"gpxVersion": root.get("version"), "creator": root.get("creator")}
    # GPX 1.1 keeps name/desc in <metadata>; GPX 1.0 puts them on the root.
    metadata.update(_metadata(metadata_element if metadata_element is not None else root))
    metadata = {key: value for key, value in metadata.items() if value is not None}

    lines: list[RawLine] = []
    # Tracks and routes share one index space, in file order.
    kinds: dict[str, SourceKind] = {"trk": "TRACK", "rte": "ROUTE"}
    for element in (child for child in root if _local(child.tag) in kinds):
        lines.append(_line(element, kinds[_local(element.tag)], len(lines), collector))

    waypoints: list[RawWaypoint] = []
    for index, element in enumerate(_children(root, "wpt")):
        location = Location(waypoint_index=index)
        point_collector = IssueCollector()
        point = _point(element, location, point_collector)
        for issue in point_collector.issues:
            # An unusable waypoint is skipped and reported; it does not affect the route geometry.
            collector.add(
                Issue(
                    issue.code, "warning", f"Waypoint skipped: {issue.message}", issue.location, issue.details
                )
                if issue.code == "INVALID_COORDINATE"
                else issue
            )
        if point is None:
            continue
        info = _metadata(element)
        waypoints.append(
            RawWaypoint(
                source_index=index,
                lon=point.lon,
                lat=point.lat,
                ele=point.ele,
                name=info.pop("name", None),
                description=info.pop("desc", None),
                comment=info.pop("cmt", None),
                symbol=_text(element, "sym"),
                source_type=info.pop("type", None),
                metadata=info,
            )
        )

    return ParsedSource(
        format="GPX",
        crs=CrsInfo(declared=None, source=WGS84_LONLAT, target=WGS84_LONLAT, reprojected=False),
        name=metadata.get("name"),
        metadata=metadata,
        lines=lines,
        waypoints=waypoints,
        issues=collector.finish(),
    )


def _line(element: ET.Element, kind: SourceKind, index: int, collector: IssueCollector) -> RawLine:
    info = _metadata(element)
    name = info.pop("name", None)
    parts: list[list[RawPoint]] = []
    if kind == "TRACK":
        containers = [(segment, "trkpt") for segment in _children(element, "trkseg")]
    else:
        containers = [(element, "rtept")]
    for part_index, (container, point_tag) in enumerate(containers):
        points: list[RawPoint] = []
        for point_index, point_element in enumerate(_children(container, point_tag)):
            location = Location(line_index=index, part_index=part_index, point_index=point_index)
            point = _point(point_element, location, collector)
            if point is not None:
                points.append(point)
        parts.append(points)
    return RawLine(kind=kind, source_index=index, name=name, metadata=info, parts=parts)
