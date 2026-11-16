#!/usr/bin/env python3
"""Resource-ID lint: no literal cloud account or resource ID in the repo's text files.

A public or widely shared repo must not carry live identifiers: they change, they help an attacker map the estate,
and they tie docs to one environment. Look them up at run time (a one-line CLI command, an IaC output, a settings
page) and write the name of the thing instead.

Kinds (all errors in --mode error; warnings in --mode warn):
  account   a standalone 12-digit number (an AWS account ID shape)
  arn       an ARN that names an account (arn:aws:<service>:<region>:<12 digits>:...)
  vpc       sg-, subnet-, vpc-, igw-, nat-, rtb-, eni-, vpce-, tgw- IDs with an 8 or 17 hex suffix
  user-pool a Cognito user-pool ID (<region>_<9 alphanumerics>)
  apigw     an API Gateway host (<10 alphanumerics>.execute-api.<region>.amazonaws.com)
  key       an AWS access key ID (AKIA / ASIA + 16)

Skips: .git, node_modules, virtualenvs, lock files, binary files, and any line with `resource-id-lint: ignore`
(use it for invented examples only, never for a real ID).

Usage: python3 tools/resource_id_lint.py [--mode error|warn] [<dir or file> ...]   (default: the repo root)
Stdlib only.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", ".next", ".terraform", ".tmp-session"}
SKIP_FILES = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock", "uv.lock", "poetry.lock", ".terraform.lock.hcl"}
IGNORE = "resource-id-lint: ignore"
_REGION = r"[a-z]{2}(?:-gov)?-[a-z]+-\d"
KINDS: list[tuple[str, re.Pattern[str]]] = [
    ("arn", re.compile(r"\barn:aws[a-z-]*:[a-z0-9-]+:(?:" + _REGION + r")?:\d{12}:")),
    ("account", re.compile(r"(?<![0-9A-Za-z_.:/-])\d{12}(?![0-9A-Za-z_])")),
    ("vpc", re.compile(r"\b(?:sg|subnet|vpc|igw|nat|rtb|eni|vpce|tgw|acl)-(?:[0-9a-f]{17}|[0-9a-f]{8})\b")),
    ("user-pool", re.compile(r"\b" + _REGION + r"_[0-9A-Za-z]{9}\b")),
    ("apigw", re.compile(r"\b[a-z0-9]{10}\.execute-api\." + _REGION + r"\.amazonaws\.com\b")),
    ("key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
]


def files(targets: list[Path]) -> list[Path]:
    out: list[Path] = []
    for t in targets:
        if t.is_file():
            out.append(t)
        elif t.is_dir():
            for p in sorted(t.rglob("*")):
                if p.is_file() and not SKIP_DIRS & set(p.relative_to(t).parts) and p.name not in SKIP_FILES:
                    out.append(p)
    return out


def findings(path: Path) -> list[tuple[int, str]]:
    try:
        text = path.read_bytes().decode("utf-8")
    except (UnicodeDecodeError, OSError):
        return []
    found = []
    for n, line in enumerate(text.splitlines(), start=1):
        if IGNORE in line:
            continue
        for kind, pat in KINDS:
            if pat.search(line):
                found.append((n, kind))
                break
    return found


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--mode", choices=("error", "warn"), default="error")
    ap.add_argument("paths", nargs="*", type=Path)
    a = ap.parse_args(argv)
    targets = a.paths or [Path(__file__).resolve().parents[1]]
    checked = files(targets)
    total = 0
    level = "error" if a.mode == "error" else "warning"
    for p in checked:
        for n, kind in findings(p):
            print(f"{p}:{n}: {level}: literal {kind} ID; look it up at run time instead (value not shown)")
            total += 1
    print(f"resource-id lint: {len(checked)} files checked, {total} finding(s)")
    return 1 if total and a.mode == "error" else 0


if __name__ == "__main__":
    sys.exit(main())
