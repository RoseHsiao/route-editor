"""Geodesic distances on the WGS 84 ellipsoid. The only place distances are computed (ADR 0001)."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import numpy.typing as npt
from pyproj import Geod

_GEOD = Geod(ellps="WGS84")

FloatArray = npt.NDArray[np.float64]


def leg_lengths_m(lons: Sequence[float], lats: Sequence[float]) -> FloatArray:
    """Length in metres of each leg between consecutive positions (n positions → n-1 legs)."""
    if len(lons) < 2:
        return np.zeros(0)
    lon = np.asarray(lons, dtype=np.float64)
    lat = np.asarray(lats, dtype=np.float64)
    _, _, distances = _GEOD.inv(lon[:-1], lat[:-1], lon[1:], lat[1:])
    return np.abs(np.asarray(distances, dtype=np.float64))


def distance_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    _, _, distance = _GEOD.inv(lon1, lat1, lon2, lat2)
    return abs(float(distance))


def cumulative_m(legs: FloatArray) -> FloatArray:
    """Cumulative distance at each position, starting at 0."""
    return np.concatenate(([0.0], np.cumsum(legs)))
