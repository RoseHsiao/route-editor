"""The worker's output conforms to contracts/geo/v1, and the committed examples are current.

The same example corpus is checked by tests/unit/import/contract.test.ts, so a change
that only one language accepts fails one of the two suites.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from conftest import CONTRACT, FIXTURES
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from trailworker import contract
from trailworker.contract_checks import SEMANTIC_CHECKS
from trailworker.importer import evaluate

SCHEMA = json.loads((CONTRACT / "contract.schema.json").read_text())
REGISTRY: Registry[Any] = Registry().with_resource(SCHEMA["$id"], Resource.from_contents(SCHEMA))
EXAMPLES = sorted((CONTRACT / "examples").glob("*.json"))
CONFORMANCE = sorted((CONTRACT / "examples" / "conformance").glob("*.json"))


def _errors(definition: str, document: Any) -> list[str]:
    validator = Draft202012Validator({"$ref": f"{SCHEMA['$id']}#/$defs/{definition}"}, registry=REGISTRY)
    structural = [error.message for error in validator.iter_errors(document)]
    if structural or definition not in SEMANTIC_CHECKS:
        return structural
    return SEMANTIC_CHECKS[definition](document)


def test_constants_match_the_contract_file() -> None:
    constants = json.loads((CONTRACT / "constants.json").read_text())
    assert constants == {
        "contractVersion": contract.CONTRACT_VERSION,
        "profileSchemaVersion": contract.PROFILE_SCHEMA_VERSION,
        "maxFileBytes": contract.MAX_FILE_BYTES,
        "maxPoints": contract.MAX_POINTS,
        "maxIssuesPerCode": contract.MAX_ISSUES_PER_CODE,
        "maxMetadataBytes": contract.MAX_METADATA_BYTES,
        "defaultGapWarnM": contract.DEFAULT_GAP_WARN_M,
        "defaultGapFailM": contract.DEFAULT_GAP_FAIL_M,
        "routeLongLegM": contract.ROUTE_LONG_LEG_M,
        "spikeMinLegM": contract.SPIKE_MIN_LEG_M,
        "spikeDetourRatio": contract.SPIKE_DETOUR_RATIO,
        "spikeMaxSpeedMps": contract.SPIKE_MAX_SPEED_MPS,
        "elevationMinM": contract.ELEVATION_MIN_M,
        "elevationMaxM": contract.ELEVATION_MAX_M,
        "profileSampleSpacingM": contract.PROFILE_SAMPLE_SPACING_M,
        "profileSmoothingWindow": contract.PROFILE_SMOOTHING_WINDOW,
    }


def test_every_fixture_has_an_example() -> None:
    fixtures = {path.stem for path in FIXTURES.iterdir() if path.suffix in (".gpx", ".geojson")}
    assert {path.stem for path in EXAMPLES} == fixtures


def _approx(value: Any) -> Any:
    if isinstance(value, float):
        return pytest.approx(value, rel=1e-12, abs=1e-9)
    if isinstance(value, list):
        return [_approx(item) for item in value]
    if isinstance(value, dict):
        return {key: _approx(item) for key, item in value.items()}
    return value


@pytest.mark.parametrize("example", EXAMPLES, ids=lambda path: path.stem)
def test_examples_match_current_worker_output(example: Path) -> None:
    committed = json.loads(example.read_text())
    fixture = FIXTURES.parent.parent / committed["fixture"]
    fresh = evaluate(fixture.read_bytes(), "GEOJSON" if fixture.suffix == ".geojson" else "GPX")
    assert {"fixture": committed["fixture"], **fresh} == _approx(committed), (
        "Worker output changed. If intended, run `uv run python scripts/generate_contract_examples.py`"
        " and review the diff."
    )


@pytest.mark.parametrize("example", EXAMPLES, ids=lambda path: path.stem)
def test_examples_conform_to_the_schema(example: Path) -> None:
    document = json.loads(example.read_text())
    assert _errors("validationReport", document["report"]) == []
    if document["outcome"] == "SUCCEEDED":
        assert _errors("normalizedImport", document["normalized"]) == []
    else:
        assert document["normalized"] is None


@pytest.mark.parametrize("case", CONFORMANCE, ids=lambda path: path.stem)
def test_conformance_corpus(case: Path) -> None:
    spec = json.loads(case.read_text())
    errors = _errors(spec["definition"], spec["document"])
    if spec["expect"] == "valid":
        assert errors == []
    else:
        assert errors, f"expected rejection: {spec['reason']}"
