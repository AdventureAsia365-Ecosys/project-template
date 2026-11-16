#!/usr/bin/env python3
"""Relative links in Markdown resolve (docs lint). Offline: external links (http, https, mailto) are not fetched.

A link `[text](path)` or `[text](path#anchor)` must name a file or folder that exists, relative to the page. Code
spans and fenced code blocks are skipped; so is a line with `docs-lint: ignore`. Anchors are not checked.

Usage: python3 tools/check_links.py [<dir or file> ...]   (default: the repo root)
Exit 0 when every link resolves, 1 otherwise. Stdlib only.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", ".pytest_cache", ".next", ".tmp-session"}
LINK = re.compile(r"!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
CODE_SPAN = re.compile(r"`[^`]*`")
EXTERNAL = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//|#)", re.IGNORECASE)


def markdown_files(targets: list[Path]) -> list[Path]:
    out: list[Path] = []
    for t in targets:
        if t.is_file() and t.suffix == ".md":
            out.append(t)
        elif t.is_dir():
            out.extend(p for p in sorted(t.rglob("*.md")) if not SKIP_DIRS & set(p.relative_to(t).parts))
    return out


def broken_links(page: Path) -> list[tuple[int, str]]:
    found = []
    fence = None
    for n, line in enumerate(page.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = line.lstrip()
        if stripped.startswith(("```", "~~~")):
            marker = stripped[:3]
            fence = None if fence == marker else (fence or marker)
            continue
        if fence or "docs-lint: ignore" in line:
            continue
        for m in LINK.finditer(CODE_SPAN.sub("", line)):
            target = m.group(1)
            if EXTERNAL.match(target) or "{" in target:
                continue
            path = target.split("#", 1)[0].split("?", 1)[0]
            if path and not (page.parent / path).exists():
                found.append((n, target))
    return found


def main(argv: list[str]) -> int:
    targets = [Path(a) for a in argv] or [Path(__file__).resolve().parents[1]]
    pages = markdown_files(targets)
    errors = 0
    for page in pages:
        for n, target in broken_links(page):
            print(f"{page}:{n}: link target not found: {target}")
            errors += 1
    print(f"links: {len(pages)} pages checked, {errors} broken link(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
