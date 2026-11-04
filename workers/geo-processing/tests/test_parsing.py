"""GPX and GeoJSON parsing: semantics are preserved, nothing is repaired or invented."""

from __future__ import annotations

import json

import pytest
from conftest import fixture_bytes

from trailworker.parsing.geojson import parse_geojson
from trailworker.parsing.gpx import parse_gpx
from trailworker.parsing.types import ParseFailedError


def _gpx(body: str, version: str = "1.1") -> bytes:
    ns = f"http://www.topografix.com/GPX/{version.replace('.', '/')}"
    return f'<?xml version="1.0"?><gpx version="{version}" creator="test" xmlns="{ns}">{body}</gpx>'.encode()


def _codes(issues: list) -> list[str]:  # type: ignore[type-arg]
    return [issue.code for issue in issues]


class TestGpx:
    def test_tracks_routes_and_waypoints_are_separate(self) -> None:
        parsed = parse_gpx(fixture_bytes("mixed-trk-rte-wpt.gpx"))
        assert [(line.kind, line.source_index, line.name) for line in parsed.lines] == [
            ("ROUTE", 0, "Planned route"),
            ("TRACK", 1, "Recorded track"),
        ]
        assert len(parsed.lines[1].parts) == 2, "each <trkseg> stays a separate part"
        assert len(parsed.lines[0].parts) == 1
        assert [w.name for w in parsed.waypoints] == [
            "Synthetic spring",
            "Synthetic hut",
            "Synthetic viewpoint",
        ]
        assert parsed.waypoints[0].symbol == "Drinking Water"
        assert parsed.waypoints[0].source_type == "water"
        assert parsed.waypoints[2].ele is None, "missing waypoint elevation is not filled in"

    def test_metadata_is_kept_verbatim(self) -> None:
        parsed = parse_gpx(
            _gpx(
                "<metadata><name>Doc</name></metadata><trk><name>T</name><desc>D</desc><cmt>C</cmt>"
                "<src>S</src><number>7</number><type>hiking</type><link href='https://example.test/t'/>"
                "<trkseg><trkpt lat='1' lon='2'/><trkpt lat='1.001' lon='2'/></trkseg></trk>"
            )
        )
        assert parsed.name == "Doc"
        assert parsed.metadata["gpxVersion"] == "1.1"
        assert parsed.lines[0].metadata == {
            "cmt": "C",
            "desc": "D",
            "src": "S",
            "type": "hiking",
            "number": "7",
            "links": ["https://example.test/t"],
        }

    def test_gpx_1_0_is_supported(self) -> None:
        parsed = parse_gpx(
            _gpx("<name>Old</name><rte><rtept lat='1' lon='2'><ele>5</ele></rtept></rte>", version="1.0")
        )
        assert parsed.name == "Old"
        assert parsed.lines[0].kind == "ROUTE"
        assert parsed.lines[0].parts[0][0].ele == 5.0

    @pytest.mark.parametrize(
        ("ele", "expected", "code"),
        [
            ("1234.5", 1234.5, None),
            ("abc", None, "INVALID_ELEVATION"),
            ("12000", None, "INVALID_ELEVATION"),
            ("nan", None, "INVALID_ELEVATION"),
            (None, None, None),
        ],
    )
    def test_elevation_is_validated_not_repaired(
        self, ele: str | None, expected: float | None, code: str | None
    ) -> None:
        tag = f"<ele>{ele}</ele>" if ele is not None else ""
        parsed = parse_gpx(_gpx(f"<trk><trkseg><trkpt lat='1' lon='2'>{tag}</trkpt></trkseg></trk>"))
        assert parsed.lines[0].parts[0][0].ele == expected
        assert _codes(parsed.issues) == ([code] if code else [])

    def test_invalid_track_coordinates_are_errors(self) -> None:
        parsed = parse_gpx(fixture_bytes("invalid-coordinates.gpx"))
        assert _codes(parsed.issues) == ["INVALID_COORDINATE"]
        assert parsed.issues[0].severity == "error"
        assert parsed.issues[0].location is not None and parsed.issues[0].location.point_index == 2

    def test_invalid_waypoints_are_skipped_with_a_warning(self) -> None:
        parsed = parse_gpx(_gpx("<wpt lat='91' lon='2'/><wpt lat='1' lon='2'/>"))
        assert len(parsed.waypoints) == 1
        assert parsed.issues[0].severity == "warning"

    @pytest.mark.parametrize(
        ("fixture", "code"), [("malformed.gpx", "MALFORMED_XML"), ("unsafe-entity.gpx", "UNSAFE_XML")]
    )
    def test_unreadable_files_fail(self, fixture: str, code: str) -> None:
        with pytest.raises(ParseFailedError) as failure:
            parse_gpx(fixture_bytes(fixture))
        assert _codes(failure.value.issues) == [code]

    def test_rejects_other_xml(self) -> None:
        with pytest.raises(ParseFailedError) as failure:
            parse_gpx(b"<kml/>")
        assert _codes(failure.value.issues) == ["NOT_GPX"]

    def test_external_entities_are_refused(self) -> None:
        payload = (
            b'<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx>&x;</gpx>'
        )
        with pytest.raises(ParseFailedError) as failure:
            parse_gpx(payload)
        assert _codes(failure.value.issues) == ["UNSAFE_XML"]


def _geojson(document: object) -> bytes:
    return json.dumps(document).encode()


LINE = {"type": "LineString", "coordinates": [[6.85, 45.8, 1000], [6.86, 45.81, 1010]]}


class TestGeoJson:
    def test_lines_points_and_unsupported_geometries(self) -> None:
        parsed = parse_geojson(fixture_bytes("lines-wgs84.geojson"))
        assert [(line.kind, line.name, len(line.parts)) for line in parsed.lines] == [
            ("LINE", "Ridge line", 1),
            ("LINE", "Two-part line", 2),
        ]
        assert [w.name for w in parsed.waypoints] == ["Synthetic col"]
        assert _codes(parsed.issues) == ["UNSUPPORTED_GEOMETRY"]
        assert parsed.crs.to_json() == {
            "declared": None,
            "source": "OGC:CRS84",
            "target": "OGC:CRS84",
            "reprojected": False,
        }

    @pytest.mark.parametrize(
        "document",
        [
            LINE,
            {"type": "Feature", "properties": None, "geometry": LINE},
            {"type": "GeometryCollection", "geometries": [LINE]},
        ],
    )
    def test_accepts_bare_geometries_features_and_collections(self, document: object) -> None:
        parsed = parse_geojson(_geojson(document))
        assert len(parsed.lines) == 1
        assert parsed.lines[0].parts[0][0].ele == 1000

    @pytest.mark.parametrize(
        "name", ["urn:ogc:def:crs:OGC:1.3:CRS84", "EPSG:4326", "urn:ogc:def:crs:EPSG::4326"]
    )
    def test_wgs84_names_are_accepted_without_reprojection(self, name: str) -> None:
        parsed = parse_geojson(
            _geojson(
                {
                    "type": "FeatureCollection",
                    "crs": {"type": "name", "properties": {"name": name}},
                    "features": [{"type": "Feature", "properties": {}, "geometry": LINE}],
                }
            )
        )
        assert parsed.crs.declared == name
        assert parsed.crs.reprojected is False
        assert (parsed.lines[0].parts[0][0].lon, parsed.lines[0].parts[0][0].lat) == (6.85, 45.8), (
            "never swapped"
        )

    def test_legacy_projected_crs_is_reprojected_and_recorded(self) -> None:
        parsed = parse_geojson(fixture_bytes("line-epsg2056.geojson"))
        assert parsed.crs.to_json() == {
            "declared": "urn:ogc:def:crs:EPSG::2056",
            "source": "EPSG:2056",
            "target": "OGC:CRS84",
            "reprojected": True,
        }
        first = parsed.lines[0].parts[0][0]
        assert first.lon == pytest.approx(7.45, abs=1e-7)
        assert first.lat == pytest.approx(46.95, abs=1e-7)
        assert first.ele == 550.0, "elevation is carried through unchanged"
        assert "CRS_REPROJECTED" in _codes(parsed.issues)

    def test_legacy_epsg_form_is_supported(self) -> None:
        parsed = parse_geojson(
            _geojson(
                {
                    "type": "FeatureCollection",
                    "crs": {"type": "EPSG", "properties": {"code": 4326}},
                    "features": [{"type": "Feature", "properties": {}, "geometry": LINE}],
                }
            )
        )
        assert parsed.crs.source == "EPSG:4326"

    @pytest.mark.parametrize(
        "crs",
        [
            {"type": "name", "properties": {"name": "EPSG:999999"}},
            {"type": "name", "properties": {"name": "urn:x-custom:crs:local"}},
            {"type": "link", "properties": {"href": "https://example.test/crs", "type": "proj4"}},
            {"type": "name", "properties": {"name": "EPSG:4979"}},
            {"type": "name", "properties": {"name": "EPSG:5773"}},
            "EPSG:4326",
        ],
    )
    def test_unknown_or_unsupported_crs_fails(self, crs: object) -> None:
        with pytest.raises(ParseFailedError) as failure:
            parse_geojson(_geojson({"type": "FeatureCollection", "crs": crs, "features": []}))
        assert _codes(failure.value.issues) == ["UNSUPPORTED_CRS"]

    def test_nested_crs_fails(self) -> None:
        document = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": LINE,
                    "crs": {"type": "name", "properties": {"name": "EPSG:2056"}},
                }
            ],
        }
        with pytest.raises(ParseFailedError) as failure:
            parse_geojson(_geojson(document))
        assert _codes(failure.value.issues) == ["UNSUPPORTED_CRS"]

    def test_axis_order_is_reported_not_swapped(self) -> None:
        parsed = parse_geojson(fixture_bytes("swapped-axes.geojson"))
        assert parsed.lines[0].parts == [[]]
        first = parsed.issues[0]
        assert first.code == "INVALID_COORDINATE"
        assert first.details["hint"] == "AXIS_ORDER"

    @pytest.mark.parametrize(
        ("data", "code"),
        [
            (b"{not json", "MALFORMED_JSON"),
            (b"[1, 2]", "NOT_GEOJSON"),
            (b'{"type": "Topology"}', "NOT_GEOJSON"),
            (b"\xff\xfe{}", "INVALID_ENCODING"),
        ],
    )
    def test_unreadable_documents_fail(self, data: bytes, code: str) -> None:
        with pytest.raises(ParseFailedError) as failure:
            parse_geojson(data)
        assert _codes(failure.value.issues) == [code]

    def test_invalid_positions_are_errors(self) -> None:
        parsed = parse_geojson(
            _geojson({"type": "LineString", "coordinates": [[6.85, 45.8], [6.86, True], ["x", 1], [1]]})
        )
        assert _codes(parsed.issues) == ["INVALID_COORDINATE"] * 3

    def test_extra_position_values_are_ignored_and_noted(self) -> None:
        parsed = parse_geojson(
            _geojson({"type": "LineString", "coordinates": [[1, 2, 3, 4], [1.1, 2, 3, 4]]})
        )
        assert parsed.lines[0].parts[0][0].ele == 3
        assert "EXTRA_COORDINATE_VALUES" in _codes(parsed.issues)
