"""Read-only check of a local GPX/GeoJSON file: parse → validate → normalize, then print a summary.

    uv run python scripts/inspect_file.py ../../fixtures/private/<file>.gpx

Writes nothing (no database, no storage, no output files) and prints no coordinates, so
it is safe for private files such as third-party GPX in fixtures/private/. It is a manual
smoke test only; no automated test depends on it.
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

from trailworker.importer import detect_format, evaluate


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    path = Path(sys.argv[1])
    data = path.read_bytes()
    result = evaluate(data, detect_format(None, data))
    report = result["report"]
    print(f"{path.name}: {result['outcome']} ({len(data) / 1024:.1f} KB)")
    print(f"summary: {report['summary']}")
    for line in report["lines"]:
        ascent = "n/a" if line["ascentM"] is None else f"{line['ascentM']:.0f} m"
        print(
            f"  {line['sourceKind']:5} {line['name']!r} main={line['isMain']} {line['distanceKm']:.2f} km,"
            f" {line['segments']} segment(s), elevation complete={line['elevationComplete']}, ascent {ascent}"
        )
    counts = Counter((issue["severity"], issue["code"]) for issue in report["issues"])
    for (severity, code), count in sorted(counts.items()):
        print(f"  {severity:7} {code} x{count}")
    return 0 if result["outcome"] == "SUCCEEDED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
