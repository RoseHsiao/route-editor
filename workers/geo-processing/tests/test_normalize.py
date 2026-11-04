"""Validation and normalization rules, checked against fixtures with known geometry."""

from __future__ import annotations

from typing import Any

import pytest
from conftest import fixture_bytes

from trailworker.importer import evaluate
from trailworker.normalize import ImportFailedError, ImportOptions, normalize
from trailworker.parsing.gpx import parse_gpx


def _issues(result: dict[str, Any], code: str) -> list[dict[str, Any]]:
    return [issue for issue in result["report"]["issues"] if issue["code"] == code]


def _gpx_track(*segments: str) -> bytes:
    body = "".join(f"<trkseg>{segment}</trkseg>" for segment in segments)
    return f'<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk>{body}</trk></gpx>'.encode()


def test_basic_track_length_and_ascent_are_within_documented_tolerance() -> None:
    result = evaluate(fixture_bytes("track-basic.gpx"), "GPX")
    assert result["outcome"] == "SUCCEEDED"
    line = result["normalized"]["lines"][0]
    # 400 geodesic legs of exactly 25 m.
    assert line["distanceKm"] == pytest.approx(10.0, abs=1e-6)
    # True ascent 600 m / descent 400 m. Smoothing lowers the peak and raises the end
    # samples by about 4 m each; docs/IMPORT_PIPELINE.md documents a ±10 m tolerance.
    assert line["ascentM"] == pytest.approx(600, abs=10)
    assert line["descentM"] == pytest.approx(400, abs=10)
    assert result["report"]["issues"] == []


def test_raw_elevation_is_preserved_in_segment_geometry() -> None:
    result = evaluate(fixture_bytes("track-basic.gpx"), "GPX")
    line = result["normalized"]["lines"][0]
    raw = [position[2] for position in line["segments"][0]["coordinates"]]
    assert raw[0] == 1000.0 and raw[240] == 1600.0 and raw[-1] == 1200.0, "source values, not smoothed ones"
    smoothed_peak = max(line["profile"]["elevationsM"])
    assert smoothed_peak < 1600.0, "the profile holds derived values only"


def test_track_segments_are_never_connected() -> None:
    result = evaluate(fixture_bytes("mixed-trk-rte-wpt.gpx"), "GPX")
    assert result["outcome"] == "SUCCEEDED", "a 1.5 km jump between <trkseg>s does not fail the import"
    track = next(line for line in result["normalized"]["lines"] if line["sourceKind"] == "TRACK")
    assert [segment["sourcePartIndex"] for segment in track["segments"]] == [0, 1]
    # Two recorded 2 km segments; the 1.5 km between them is not counted.
    assert track["distanceKm"] == pytest.approx(4.0, abs=1e-6)
    assert track["profile"]["segmentStartIndices"] == [0, 82]
    distances = track["profile"]["distancesKm"]
    assert distances[81] == distances[82], "the profile restarts at the break"
    [discontinuity] = _issues(result, "SEGMENT_DISCONTINUITY")
    assert discontinuity["severity"] == "warning"
    assert discontinuity["details"]["separationM"] == pytest.approx(1500, abs=0.5)


def test_main_variant_prefers_tracks_over_routes() -> None:
    result = evaluate(fixture_bytes("mixed-trk-rte-wpt.gpx"), "GPX")
    assert [(line["sourceKind"], line["isMain"]) for line in result["normalized"]["lines"]] == [
        ("ROUTE", False),
        ("TRACK", True),
    ]


def test_route_legs_are_planned_connections_not_gaps() -> None:
    result = evaluate(fixture_bytes("mixed-trk-rte-wpt.gpx"), "GPX")
    route = next(line for line in result["normalized"]["lines"] if line["sourceKind"] == "ROUTE")
    assert route["distanceKm"] == pytest.approx(4.8, abs=1e-6)
    assert len(_issues(result, "ROUTE_LONG_LEG")) == 4
    assert all(issue["severity"] == "info" for issue in _issues(result, "ROUTE_LONG_LEG"))
    assert not _issues(result, "GAP_TOO_LARGE")


def test_quality_issues_are_detected_and_located() -> None:
    result = evaluate(fixture_bytes("track-quality-issues.gpx"), "GPX")
    assert result["outcome"] == "SUCCEEDED"
    assert result["report"]["summary"]["duplicatesRemoved"] == 1
    [spike] = _issues(result, "GPS_SPIKE")
    assert spike["location"]["pointIndex"] == 51  # index in the source file, duplicates included
    assert spike["details"]["reason"] == "OUT_AND_BACK"
    [gap] = _issues(result, "LARGE_GAP")
    assert gap["details"]["lengthM"] == pytest.approx(325, abs=1)
    assert len(_issues(result, "INVALID_ELEVATION")) == 2
    [incomplete] = _issues(result, "ELEVATION_INCOMPLETE")
    assert incomplete["details"] == {"pointsWithElevation": 196, "points": 201}


def test_spikes_are_reported_but_kept() -> None:
    result = evaluate(fixture_bytes("track-quality-issues.gpx"), "GPX")
    segment = result["normalized"]["lines"][0]["segments"][0]
    assert segment["pointCount"] == 201, "only the exact duplicate was removed"


def test_incomplete_elevation_is_never_filled_in() -> None:
    result = evaluate(fixture_bytes("track-quality-issues.gpx"), "GPX")
    line = result["normalized"]["lines"][0]
    segment = line["segments"][0]
    assert segment["hasElevation"] is False
    assert segment["elevationPointCount"] == 196
    assert all(len(position) == 2 for position in segment["coordinates"])
    assert (segment["ascentM"], segment["descentM"]) == (None, None)
    assert line["profile"]["elevationsM"] == []
    assert line["profile"]["elevationSource"] == "NONE"
    assert (line["ascentM"], line["descentM"]) == (None, None)


def test_gap_above_failure_threshold_fails_with_location() -> None:
    result = evaluate(fixture_bytes("track-large-gap.gpx"), "GPX")
    assert result["outcome"] == "FAILED"
    [gap] = _issues(result, "GAP_TOO_LARGE")
    assert gap["location"]["pointIndex"] == 40
    assert gap["details"]["lengthM"] == pytest.approx(2000, abs=1)
    assert _issues(result, "IMPLAUSIBLE_SPEED"), "the 360 km/h jump is reported as well"


def test_gap_thresholds_are_configurable() -> None:
    lenient = evaluate(
        fixture_bytes("track-large-gap.gpx"), "GPX", ImportOptions(gap_warn_m=100, gap_fail_m=5000)
    )
    assert lenient["outcome"] == "SUCCEEDED"
    assert _issues(lenient, "LARGE_GAP")


@pytest.mark.parametrize(
    "options",
    [{"gapWarnM": 0}, {"gapWarnM": 2000, "gapFailM": 1000}, {"gapFailM": "far"}, {"gapWarnM": True}],
)
def test_invalid_options_are_rejected(options: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        ImportOptions.from_json(options)


def test_duplicates_only_segment_is_skipped_and_reported() -> None:
    gpx = _gpx_track(
        "<trkpt lat='1' lon='2'/><trkpt lat='1' lon='2'/>",
        "<trkpt lat='1.001' lon='2'/><trkpt lat='1.002' lon='2'/>",
    )
    normalized = normalize(parse_gpx(gpx))
    assert [segment.source_part_index for segment in normalized.lines[0].segments] == [1]
    codes = [issue.code for issue in normalized.report.issues]
    assert "SEGMENT_TOO_SHORT" in codes and "DUPLICATE_POINTS_REMOVED" in codes


def test_file_without_lines_fails() -> None:
    gpx = b'<gpx version="1.1"><wpt lat="1" lon="2"/></gpx>'
    with pytest.raises(ImportFailedError) as failure:
        normalize(parse_gpx(gpx))
    assert [issue.code for issue in failure.value.report.issues] == ["NO_ROUTE_GEOMETRY"]


def test_parse_errors_stop_before_downstream_checks() -> None:
    result = evaluate(fixture_bytes("swapped-axes.geojson"), "GEOJSON")
    assert {issue["code"] for issue in result["report"]["issues"]} == {"INVALID_COORDINATE"}


def test_unsupported_geometries_alone_fail() -> None:
    result = evaluate(fixture_bytes("unsupported-only.geojson"), "GEOJSON")
    assert result["outcome"] == "FAILED"
    assert [issue["code"] for issue in result["report"]["issues"]] == [
        "UNSUPPORTED_GEOMETRY",
        "NO_ROUTE_GEOMETRY",
    ]


def test_multilinestring_parts_stay_separate() -> None:
    result = evaluate(fixture_bytes("lines-wgs84.geojson"), "GEOJSON")
    two_part = result["normalized"]["lines"][1]
    assert two_part["sourceKind"] == "LINE"
    assert [segment["sourcePartIndex"] for segment in two_part["segments"]] == [0, 1]
    assert two_part["distanceKm"] == pytest.approx(2.0, abs=1e-6)
    assert two_part["profile"]["elevationSource"] == "NONE"
