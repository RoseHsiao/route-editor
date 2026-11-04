"""Elevation profile: resample, smooth, then sum ascent and descent (ADR 0009).

Pure and deterministic: the same segment geometry and the same parameters always
produce the same profile, so a stored profile can be rebuilt from `trail_segments`
and `variant_profiles.processing_params` (see tests/test_profile.py).

Raw source elevation is never modified. It stays in the segment geometry (Z values);
the profile holds derived, smoothed values only.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from .contract import PROFILE_SAMPLE_SPACING_M, PROFILE_SCHEMA_VERSION, PROFILE_SMOOTHING_WINDOW
from .geodesy import FloatArray, cumulative_m, leg_lengths_m

#: Vertex as stored: (lon, lat) or (lon, lat, ele).
Vertex = tuple[float, ...]


def processing_params(
    spacing_m: float = PROFILE_SAMPLE_SPACING_M, window: int = PROFILE_SMOOTHING_WINDOW
) -> dict[str, Any]:
    """The full description of the method, stored with every profile."""
    return {
        "distance": {"method": "geodesic", "ellipsoid": "WGS84"},
        "resampling": {"method": "linear_interpolation", "spacingM": spacing_m, "includeSegmentEnd": True},
        "smoothing": {"method": "centered_moving_average", "windowSamples": window, "edges": "shrink_window"},
        "ascent": {"method": "sum_of_positive_differences", "thresholdM": 0.0, "acrossSegmentBreaks": False},
    }


@dataclass(frozen=True)
class SegmentProfile:
    length_m: float
    sample_m: FloatArray
    #: Smoothed elevation per sample, or None when the segment's elevation is incomplete.
    smoothed_m: FloatArray | None
    ascent_m: float | None
    descent_m: float | None


@dataclass(frozen=True)
class Profile:
    schema_version: int
    sample_spacing_m: float
    distances_km: list[float]
    elevations_m: list[float]
    elevation_complete: bool
    segment_start_indices: list[int]
    ascent_m: float | None
    descent_m: float | None
    params: dict[str, Any]

    @property
    def elevation_source(self) -> str:
        return "SOURCE_FILE" if self.elevation_complete else "NONE"

    def to_json(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "sampleSpacingM": self.sample_spacing_m,
            "distancesKm": self.distances_km,
            "elevationsM": self.elevations_m,
            "elevationSource": self.elevation_source,
            "elevationComplete": self.elevation_complete,
            "segmentStartIndices": self.segment_start_indices,
            "processingParams": self.params,
        }


def _sample_positions(length_m: float, spacing_m: float) -> FloatArray:
    samples = np.arange(0.0, length_m, spacing_m, dtype=np.float64)
    if samples.size == 0 or samples[-1] < length_m:
        samples = np.append(samples, length_m)
    if samples.size == 1:
        samples = np.array([0.0, length_m])
    return samples


def _smooth(values: FloatArray, window: int) -> FloatArray:
    half = window // 2
    sums = np.concatenate(([0.0], np.cumsum(values)))
    n = values.size
    starts = np.maximum(np.arange(n) - half, 0)
    ends = np.minimum(np.arange(n) + half + 1, n)
    return np.asarray((sums[ends] - sums[starts]) / (ends - starts), dtype=np.float64)


def segment_profile(vertices: Sequence[Vertex], spacing_m: float, window: int) -> SegmentProfile:
    lons = [vertex[0] for vertex in vertices]
    lats = [vertex[1] for vertex in vertices]
    cumulative = cumulative_m(leg_lengths_m(lons, lats))
    length = float(cumulative[-1])
    samples = _sample_positions(length, spacing_m)
    if not all(len(vertex) >= 3 for vertex in vertices):
        return SegmentProfile(length, samples, None, None, None)
    raw = np.asarray([vertex[2] for vertex in vertices], dtype=np.float64)
    smoothed = _smooth(np.interp(samples, cumulative, raw), window)
    steps = np.diff(smoothed)
    return SegmentProfile(
        length_m=length,
        sample_m=samples,
        smoothed_m=smoothed,
        ascent_m=float(steps[steps > 0].sum()),
        descent_m=float(-steps[steps < 0].sum()),
    )


def build_profile(
    segments: Sequence[Sequence[Vertex]],
    spacing_m: float = PROFILE_SAMPLE_SPACING_M,
    window: int = PROFILE_SMOOTHING_WINDOW,
) -> tuple[Profile, list[SegmentProfile]]:
    """Profile of a line made of separate segments, in order. Nothing is computed across breaks."""
    parts = [segment_profile(segment, spacing_m, window) for segment in segments]
    complete = all(part.smoothed_m is not None for part in parts)
    distances: list[float] = []
    elevations: list[float] = []
    starts: list[int] = []
    offset_m = 0.0
    for part in parts:
        starts.append(len(distances))
        distances.extend(((part.sample_m + offset_m) / 1000.0).tolist())
        if complete and part.smoothed_m is not None:
            elevations.extend(part.smoothed_m.tolist())
        offset_m += part.length_m
    ascent = sum(part.ascent_m for part in parts if part.ascent_m is not None) if complete else None
    descent = sum(part.descent_m for part in parts if part.descent_m is not None) if complete else None
    profile = Profile(
        schema_version=PROFILE_SCHEMA_VERSION,
        sample_spacing_m=spacing_m,
        distances_km=distances,
        elevations_m=elevations,
        elevation_complete=complete,
        segment_start_indices=starts,
        ascent_m=ascent,
        descent_m=descent,
        params=processing_params(spacing_m, window),
    )
    return profile, parts


def rebuild_from_params(segments: Sequence[Sequence[Vertex]], params: dict[str, Any]) -> Profile:
    """Recomputes a profile from stored geometry and its recorded processing parameters.

    Refuses parameters describing a method this code does not implement, so a stored
    profile is never silently "reproduced" with a different algorithm.
    """
    expected = processing_params(
        float(params["resampling"]["spacingM"]), int(params["smoothing"]["windowSamples"])
    )
    for section in ("distance", "resampling", "smoothing", "ascent"):
        if params.get(section) != expected[section]:
            raise ValueError(f"unsupported {section} parameters: {params.get(section)!r}")
    profile, _ = build_profile(
        segments,
        spacing_m=float(params["resampling"]["spacingM"]),
        window=int(params["smoothing"]["windowSamples"]),
    )
    return profile
