#!/usr/bin/env python3
"""Coverage ratchet: the line coverage of a Cobertura report (coverage.xml) never drops below the recorded floor.

The floor lives in .github/coverage-floor.json as {"<name>": <percent>}. `check` fails when today's coverage is more
than 0.1 point under the floor; `raise` moves the floor up to today's value (never down) - commit that change.

Usage: python3 .github/scripts/coverage_ratchet.py check|raise <name> <coverage.xml>
Stdlib only.
"""

from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

FLOOR = Path(__file__).resolve().parents[1] / "coverage-floor.json"
SLACK = 0.1


def percent(report: Path) -> float:
    rate = ET.parse(report).getroot().get("line-rate")
    if rate is None:
        raise SystemExit(f"{report}: no line-rate attribute (not a Cobertura report)")
    return round(float(rate) * 100, 2)


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[0] not in ("check", "raise"):
        print("usage: coverage_ratchet.py check|raise <name> <coverage.xml>")
        return 2
    cmd, name, report = argv[0], argv[1], Path(argv[2])
    floors = json.loads(FLOOR.read_text(encoding="utf-8")) if FLOOR.is_file() else {}
    now, floor = percent(report), float(floors.get(name, 0))
    if cmd == "raise":
        if now > floor:
            floors[name] = now
            FLOOR.write_text(json.dumps(floors, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"coverage {name}: {now}% (floor {max(now, floor)}%)")
        return 0
    print(f"coverage {name}: {now}% (floor {floor}%)")
    if now + SLACK < floor:
        print(f"coverage {name} dropped below its floor; add tests (the floor never goes down)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
