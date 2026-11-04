"""Profile method: resampling, smoothing, ascent, and reproducibility from stored parameters."""

from __future__ import annotations

import math

import pytest

from trailworker.geodesy import distance_m, leg_lengths_m
from trailworker.profile import build_profile, processing_params, rebuild_from_params


def _meridian(points: int, spacing_deg: float, elevations: list[float] | None) -> list[tuple[float, ...]]:
    if elevations is None:
        return [(6.85, 45.8 + i * spacing_deg) for i in range(points)]
    return [(6.85, 45.8 + i * spacing_deg, elevations[i]) for i in range(points)]


def test_geodesic_distance_matches_known_value() -> None:
    # Meridian arc of 1° centred on 45°N, WGS 84: 111132.954 - 559.822 cos(90°) + 1.175 cos(180°)
    # = 111131.779 m (series expansion, accurate to a few centimetres).
    assert distance_m(0.0, 44.5, 0.0, 45.5) == pytest.approx(111_131.779, abs=0.05)
    assert leg_lengths_m([0.0, 0.0], [44.5, 45.5])[0] == pytest.approx(111_131.779, abs=0.05)


def test_resampling_spacing_and_segment_end() -> None:
    profile, _ = build_profile([_meridian(3, 0.001, [100.0, 110.0, 100.0])], spacing_m=25.0, window=1)
    length_km = profile.distances_km[-1]
    assert profile.distances_km[0] == 0.0
    assert profile.distances_km[1] == pytest.approx(0.025)
    assert length_km == pytest.approx(0.2223, abs=1e-3), "the segment end is always a sample"
    steps = [b - a for a, b in zip(profile.distances_km, profile.distances_km[1:], strict=False)]
    assert all(step <= 0.025 + 1e-12 for step in steps)


def test_without_smoothing_ascent_approaches_raw_ascent() -> None:
    # Vertices do not fall exactly on the 1 m sample grid, so interpolation trims peaks slightly.
    elevations = [100.0, 150.0, 120.0, 180.0, 180.0]
    profile, _ = build_profile([_meridian(5, 0.0005, elevations)], spacing_m=1.0, window=1)
    assert profile.ascent_m == pytest.approx(110.0, abs=1.0)
    assert profile.descent_m == pytest.approx(30.0, abs=1.0)


def test_smoothing_suppresses_gps_noise() -> None:
    # 2 km climb of 100 m with ±3 m noise of 75 m wavelength, as from a jittery GPS.
    n = 81
    noisy = [1000.0 + i * 1.25 + 3.0 * math.sin(i * 2 * math.pi / 3) for i in range(n)]
    raw, _ = build_profile([_meridian(n, 0.000225, noisy)], spacing_m=25.0, window=1)
    smoothed, _ = build_profile([_meridian(n, 0.000225, noisy)])
    assert raw.ascent_m is not None and smoothed.ascent_m is not None
    assert raw.ascent_m > 180, "noise doubles raw ascent"
    assert smoothed.ascent_m == pytest.approx(100, abs=6)


def test_nothing_is_computed_across_segment_breaks() -> None:
    first = _meridian(5, 0.0005, [100.0] * 5)
    second = [(7.0, 46.0 + i * 0.0005, 900.0) for i in range(5)]
    profile, _ = build_profile([first, second], spacing_m=25.0, window=7)
    assert profile.ascent_m == 0.0, "the 800 m step between segments is not ascent"
    assert profile.segment_start_indices[1] > 0
    start = profile.segment_start_indices[1]
    assert profile.distances_km[start] == profile.distances_km[start - 1]
    assert profile.elevations_m[start - 1] == 100.0 and profile.elevations_m[start] == 900.0


def test_incomplete_elevation_yields_no_elevation_profile() -> None:
    profile, parts = build_profile([_meridian(5, 0.0005, [1.0] * 5), _meridian(5, 0.0005, None)])
    assert profile.elevation_complete is False
    assert profile.elevations_m == []
    assert profile.ascent_m is None and profile.descent_m is None
    assert parts[0].ascent_m == 0.0 and parts[1].ascent_m is None
    assert profile.elevation_source == "NONE"


def test_profile_is_reproducible_from_stored_parameters() -> None:
    segments = [_meridian(40, 0.0003, [1000.0 + (i % 7) * 4.0 + i for i in range(40)])]
    profile, _ = build_profile(segments, spacing_m=20.0, window=5)
    assert profile.params == processing_params(20.0, 5)
    rebuilt = rebuild_from_params(segments, profile.params)
    assert rebuilt == profile


def test_rebuild_refuses_unknown_methods() -> None:
    params = processing_params()
    params["smoothing"]["method"] = "savitzky_golay"
    with pytest.raises(ValueError, match="smoothing"):
        rebuild_from_params([_meridian(3, 0.001, [1.0, 2.0, 3.0])], params)
