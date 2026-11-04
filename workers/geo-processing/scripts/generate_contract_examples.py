"""Regenerates contracts/geo/v1/examples/*.json from the synthetic fixtures.

    uv run python scripts/generate_contract_examples.py

Each example is the worker's output for one fixture. tests/test_contract.py checks
that the committed examples still match what the worker produces, and the TypeScript
tests (tests/unit/import/contract.test.ts) parse the same files.
"""

from __future__ import annotations

import json
from pathlib import Path

from trailworker.importer import evaluate

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "fixtures" / "synthetic"
EXAMPLES = ROOT / "contracts" / "geo" / "v1" / "examples"


def main() -> None:
    EXAMPLES.mkdir(parents=True, exist_ok=True)
    for fixture in sorted(FIXTURES.iterdir()):
        if fixture.suffix not in (".gpx", ".geojson"):
            continue
        result = evaluate(fixture.read_bytes(), "GEOJSON" if fixture.suffix == ".geojson" else "GPX")
        document = {"fixture": f"fixtures/synthetic/{fixture.name}", **result}
        target = EXAMPLES / f"{fixture.stem}.json"
        target.write_text(json.dumps(document, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {target.relative_to(ROOT)} ({result['outcome']})")


if __name__ == "__main__":
    main()
