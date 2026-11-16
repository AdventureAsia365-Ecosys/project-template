#!/usr/bin/env python3
"""Kit copies: the byte-copy guard, the copy sync and the leak scan of the project template.

The template copies its docs templates, playbook pages, generic skills and hooks from one source repo (one home per
fact). `kit-sources.txt` lists them as `<source path> <dest path>` pairs; `.kit-source-ref` records the source commit
the copies were taken from. Every copy must equal `kit_transform(<source>)` byte for byte (tools/kit_transform.py:
the source's project-only lines left out, its copy-only lines put in). A hand edit of a copy, a source change that
was not synced, or a file listed but missing turns `check` red.

  check  --source <dir>   compare every copy with the transform of its source (a checkout of the source repo at
                          the commit in .kit-source-ref); also fails on a listed dest that is missing here
  sync   --source <dir>   rewrite every copy from the source and record the source commit in .kit-source-ref
                          (run by a maintainer, then commit the result as `chore: sync kit copies`)
  scan   --denylist <file> [<dir>]
                          fail when a path or a text line under <dir> (default: the repo) matches a pattern of the
                          denylist file (one Python regex per line, # comments). The list itself is not kept in
                          this public repo: CI writes it from the LEAK_DENYLIST Actions variable.
  scan-history --denylist <file> [--rev <rev>] [<dir>]
                          the same denylist over the commit metadata of every commit reachable from <rev>
                          (default HEAD) in the git repo at <dir>: author and committer name and e-mail, and the
                          message. File scans cannot see who wrote a commit; a pushed history is public for good.

Exit 0 when clean, 1 on a finding, 2 on a usage error. Stdlib only.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
from kit_transform import MarkerError, transform_bytes  # noqa: E402

SOURCES = REPO / "kit-sources.txt"
REF_FILE = REPO / ".kit-source-ref"
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", ".pytest_cache", ".tmp-session", "_source"}


def read_pairs(path: Path) -> list[tuple[int, str, str]]:
    pairs = []
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        words = line.split()
        if len(words) != 2:
            raise SystemExit(f"{path.name}:{n}: expected `<source> <dest>`, got {len(words)} field(s)")
        dest = PurePosixPath(words[1])
        if dest.is_absolute() or ".." in dest.parts:
            raise SystemExit(f"{path.name}:{n}: dest {words[1]} must be a relative path inside this repo")
        pairs.append((n, words[0], words[1]))
    return pairs


def expected(source_root: Path, src: str) -> bytes:
    path = source_root / src
    if not path.is_file():
        raise FileNotFoundError(src)
    return transform_bytes(path.read_bytes(), src)


def check(source_root: Path, repo: Path = REPO, sources: Path = SOURCES) -> list[str]:
    errors = []
    seen: set[str] = set()
    for n, src, dest in read_pairs(sources):
        if dest in seen:
            errors.append(f"{sources.name}:{n}: dest {dest} is listed twice")
        seen.add(dest)
        try:
            want = expected(source_root, src)
        except FileNotFoundError:
            errors.append(f"{sources.name}:{n}: source {src} does not exist in the source repo")
            continue
        except MarkerError as e:
            errors.append(f"source {e}")
            continue
        copy = repo / dest
        if not copy.is_file():
            errors.append(f"{dest}: missing (copy of {src}); run `tools/kit_copies.py sync`")
        elif copy.read_bytes() != want:
            errors.append(f"{dest}: differs from the transform of {src}; edit the source, then sync (never the copy)")
    return errors


def source_commit(source_root: Path) -> str:
    out = subprocess.run(["git", "-C", str(source_root), "rev-parse", "HEAD"], capture_output=True, text=True)
    sha = out.stdout.strip()
    if out.returncode != 0 or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise SystemExit(f"{source_root} is not a git checkout of the source repo")
    return sha


def sync(source_root: Path, repo: Path = REPO, sources: Path = SOURCES) -> list[str]:
    """Rewrite the copies; the list copies itself too, so a changed list is read again until nothing moves."""
    changed: list[str] = []
    for _ in range(3):
        step = _sync_once(source_root, repo, sources)
        changed += [c for c in step if c not in changed]
        if not step:
            break
    (repo / REF_FILE.name).write_text(source_commit(source_root) + "\n", encoding="utf-8")
    return changed


def _sync_once(source_root: Path, repo: Path, sources: Path) -> list[str]:
    changed = []
    for _, src, dest in read_pairs(sources):
        want = expected(source_root, src)
        copy = repo / dest
        if not copy.is_file() or copy.read_bytes() != want:
            copy.parent.mkdir(parents=True, exist_ok=True)
            copy.write_bytes(want)
            changed.append(dest)
        if src.endswith(".sh") or want.startswith(b"#!"):
            copy.chmod(0o755)
    return changed


def load_denylist(path: Path) -> list[re.Pattern[str]]:
    pats = []
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            pats.append(re.compile(line))
        except re.error as e:
            raise SystemExit(f"denylist line {n}: not a valid regex ({e})") from e
    return pats


def scan(base: Path, pats: list[re.Pattern[str]]) -> list[str]:
    """Findings name the file, line and pattern number only, never the matched text (the log is public)."""
    found = []
    for p in sorted(base.rglob("*")):
        rel_parts = p.relative_to(base).parts
        if not p.is_file() or SKIP_DIRS & set(rel_parts):
            continue
        rel = p.relative_to(base).as_posix()
        for i, pat in enumerate(pats, start=1):
            if pat.search(rel):
                found.append(f"{rel}: the path matches denylist pattern #{i}")
                break
        try:
            text = p.read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            continue
        for ln, line in enumerate(text.splitlines(), start=1):
            for i, pat in enumerate(pats, start=1):
                if pat.search(line):
                    found.append(f"{rel}:{ln}: matches denylist pattern #{i}")
                    break
    return found


HISTORY_FIELDS = ("author name", "author e-mail", "committer name", "committer e-mail", "message")


def scan_history(repo: Path, pats: list[re.Pattern[str]], rev: str = "HEAD") -> list[str]:
    """Findings name the commit, the field and the pattern number only, never the matched text."""
    out = subprocess.run(
        ["git", "-C", str(repo), "log", "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e", rev],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout
    found = []
    for record in out.split("\x1e"):
        record = record.lstrip("\n")
        if not record:
            continue
        sha, *fields = record.split("\x00")
        for name, value in zip(HISTORY_FIELDS, fields, strict=True):
            for i, pat in enumerate(pats, start=1):
                if any(pat.search(line) for line in value.splitlines() or [value]):
                    found.append(f"commit {sha[:12]}: the {name} matches denylist pattern #{i}")
                    break
    return found


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("check", "sync"):
        sp = sub.add_parser(name)
        sp.add_argument("--source", type=Path, required=True, help="checkout of the source repo")
    sp = sub.add_parser("scan")
    sp.add_argument("--denylist", type=Path, required=True)
    sp.add_argument("dir", type=Path, nargs="?", default=REPO)
    sp = sub.add_parser("scan-history")
    sp.add_argument("--denylist", type=Path, required=True)
    sp.add_argument("--rev", default="HEAD", help="scan the commits reachable from this revision")
    sp.add_argument("dir", type=Path, nargs="?", default=REPO)
    a = ap.parse_args(argv)
    if a.cmd == "check":
        errors = check(a.source)
        for e in errors:
            print(e)
        print(f"kit copies: {len(read_pairs(SOURCES))} checked, {len(errors)} problem(s)")
        return 1 if errors else 0
    if a.cmd == "sync":
        changed = sync(a.source)
        for c in changed:
            print(f"updated {c}")
        print(f"kit copies: {len(changed)} updated; source commit recorded in {REF_FILE.name}")
        return 0
    pats = load_denylist(a.denylist)
    if not pats:
        print("leak scan: the denylist is empty; set the LEAK_DENYLIST Actions variable")
        return 2
    if a.cmd == "scan-history":
        found = scan_history(a.dir, pats, a.rev)
        label = "history scan"
    else:
        found = scan(a.dir, pats)
        label = "leak scan"
    for f in found:
        print(f)
    print(f"{label}: {len(pats)} pattern(s), {len(found)} finding(s)")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
