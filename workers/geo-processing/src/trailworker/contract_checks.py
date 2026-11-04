"""Cross-field rules of the geo contract that JSON Schema cannot express.

Mirrors `x-semanticRules` in contracts/geo/v1/contract.schema.json and the TypeScript
implementation in lib/import/contract.ts. Both are run against the same example corpus
(contracts/geo/v1/examples), so the two languages must agree on every rule.
"""

from __future__ import annotations

from itertools import pairwise
from typing import Any


def profile_errors(profile: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    distances: list[float] = profile["distancesKm"]
    elevations: list[float] = profile["elevationsM"]
    starts: list[int] = profile["segmentStartIndices"]
    if distances and distances[0] != 0:
        errors.append("distancesKm must start at 0")
    if not starts or starts[0] != 0:
        errors.append("segmentStartIndices must start with 0")
    if any(b <= a for a, b in pairwise(starts)):
        errors.append("segmentStartIndices must be strictly increasing")
    if any(index >= len(distances) for index in starts):
        errors.append("segmentStartIndices must index into distancesKm")
    start_set = set(starts)
    for i in range(1, len(distances)):
        if distances[i] < distances[i - 1]:
            errors.append("distancesKm must be non-decreasing")
            break
        if distances[i] == distances[i - 1] and i not in start_set:
            errors.append("distancesKm may only repeat at a segment start")
            break
    complete = profile["elevationComplete"]
    if complete != (len(elevations) > 0):
        errors.append("elevationComplete must equal (elevationsM is not empty)")
    if elevations and len(elevations) != len(distances):
        errors.append("elevationsM must be empty or parallel to distancesKm")
    if (profile["elevationSource"] == "NONE") == complete:
        errors.append("elevationSource is NONE exactly when elevation is incomplete")
    return errors


def segment_errors(segment: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    coordinates: list[list[float]] = segment["coordinates"]
    if segment["pointCount"] != len(coordinates):
        errors.append("pointCount must equal the number of coordinates")
    all_3d = all(len(position) == 3 for position in coordinates)
    if segment["elevationPointCount"] > segment["pointCount"]:
        errors.append("elevationPointCount cannot exceed pointCount")
    complete = segment["elevationPointCount"] == segment["pointCount"]
    if segment["hasElevation"] != complete or segment["hasElevation"] != all_3d:
        errors.append("hasElevation must match the elevation count and the coordinate dimension")
    if not segment["hasElevation"] and (segment["ascentM"] is not None or segment["descentM"] is not None):
        errors.append("ascentM/descentM require elevation")
    return errors


def report_errors(report: dict[str, Any]) -> list[str]:
    has_error = any(issue["severity"] == "error" for issue in report["issues"])
    if (report["outcome"] == "FAILED") != has_error:
        return ["outcome must be FAILED exactly when an issue has severity error"]
    return []


def normalized_import_errors(document: dict[str, Any]) -> list[str]:
    errors = report_errors(document["report"])
    if document["report"]["outcome"] != "SUCCEEDED":
        errors.append("a normalized import must come from a successful report")
    if sum(1 for line in document["lines"] if line["isMain"]) != 1:
        errors.append("exactly one line must be the main line")
    for line in document["lines"]:
        errors += profile_errors(line["profile"])
        for segment in line["segments"]:
            errors += segment_errors(segment)
    return errors


SEMANTIC_CHECKS = {
    "profile": profile_errors,
    "segment": segment_errors,
    "validationReport": report_errors,
    "normalizedImport": normalized_import_errors,
}
