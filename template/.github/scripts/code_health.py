#!/usr/bin/env python3
"""Code-health ratchet: file length for every source file, cyclomatic complexity for Python functions.

Limits and the baseline are in .github/code-health.json. A file or function over a limit fails unless the baseline
lists it with a value at least as high as today's; a baseline entry that is no longer needed (the code got better)
fails too, so the baseline only shrinks. Keys: "<path>" for file length, "<path>::<function>" for complexity.

Usage: python3 .github/scripts/code_health.py [--config .github/code-health.json]
Stdlib only.
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRANCHES = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.IfExp, ast.ExceptHandler, ast.With, ast.AsyncWith,
            ast.Assert, ast.comprehension, ast.match_case)


def complexity(fn: ast.AST) -> int:
    """McCabe-style: 1 + branches + extra boolean operands, not counting nested functions."""
    score = 1
    stack = list(ast.iter_child_nodes(fn))
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
            continue
        if isinstance(node, BRANCHES):
            score += 1
        elif isinstance(node, ast.BoolOp):
            score += len(node.values) - 1
        stack.extend(ast.iter_child_nodes(node))
    return score


def source_files(root: Path, cfg: dict) -> list[Path]:
    exts, excl = set(cfg["extensions"]), set(cfg["exclude_dirs"])
    return [
        p
        for p in sorted(root.rglob("*"))
        if p.is_file() and p.suffix in exts and not excl & set(p.relative_to(root).parts)
    ]


def complex_functions(rel: str, text: str, limit: int) -> dict[str, tuple[str, int]]:
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return {}
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and complexity(node) > limit:
            out[f"{rel}::{node.name}"] = ("complexity", complexity(node))
    return out


def measure(root: Path, cfg: dict) -> dict[str, tuple[str, int]]:
    out: dict[str, tuple[str, int]] = {}
    for p in source_files(root, cfg):
        rel = p.relative_to(root).as_posix()
        text = p.read_text(encoding="utf-8", errors="replace")
        lines = text.count("\n") + 1
        if lines > cfg["max_file_lines"]:
            out[rel] = ("lines", lines)
        if p.suffix == ".py":
            out.update(complex_functions(rel, text, cfg["max_complexity"]))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=ROOT / ".github" / "code-health.json")
    ap.add_argument("--root", type=Path, default=ROOT)
    a = ap.parse_args(argv)
    cfg = json.loads(a.config.read_text(encoding="utf-8"))
    baseline: dict[str, int] = cfg.get("baseline", {})
    over = measure(a.root, cfg)
    errors = []
    for key, (kind, value) in over.items():
        allowed = baseline.get(key)
        if allowed is None or value > allowed:
            limit = cfg["max_file_lines"] if kind == "lines" else cfg["max_complexity"]
            errors.append(f"{key}: {kind} {value} over the limit {limit}; split it (or, with a reason, baseline it)")
    for key, allowed in baseline.items():
        if key not in over or over[key][1] < allowed:
            errors.append(f"{key}: baseline {allowed} is stale; lower it to today's value or remove the entry")
    for e in errors:
        print(e)
    print(f"code health: {len(over)} over a limit, {len(baseline)} baselined, {len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
