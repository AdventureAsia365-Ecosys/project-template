#!/usr/bin/env python3
"""Render matrix: generate the template with several answer sets and run each generated project's own checks.

Variants cover the defaults, every option on, the root-repo layout and the app-repo layout. For each one:
  - copier copy (the template at the working tree, so uncommitted changes are tested too);
  - no unrendered Jinja left in any file or path;
  - the generated fast checks: links, resource-ID lint, code health, the hook settings test;
  - the stack checks the variant has: API ruff + pytest (one shared virtualenv), Lambda tests, web unit tests
    (node --test, no install), terraform fmt, actionlint over the generated workflows and markdownlint (each when
    its tool is given).
The guardrail red-team scripts run once (first variant): they are byte copies and slow to start.

Usage: python3 tests/render_matrix.py [--variant NAME ...] [--keep DIR] [--venv DIR] [--actionlint BIN] [--markdownlint]
Exit 0 when every check of every variant passes.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

VARIANTS: dict[str, dict[str, str]] = {
    "defaults": {"project_name": "Harbor Notes", "issue_key_prefix": "HN"},
    "all-on": {
        "project_name": "Lantern Desk",
        "issue_key_prefix": "LD",
        "stacks": "[python-api, nextjs-web, lambda]",
        "multi_tenant": "true",
        "ai_features": "true",
        "tracker": "github",
        "secondary_language": "vi",
        "team_shape": "engineers-plus-agents",
        "license": "MIT",
    },
    "root": {
        "project_name": "Orchard Hub",
        "issue_key_prefix": "OH",
        "repo_layout": "root",
        "cloud": "none",
        "tracker": "jira",
        "team_shape": "engineers-only",
    },
    "app": {
        "project_name": "Orchard Hub Billing",
        "issue_key_prefix": "OHB",
        "repo_layout": "app",
        "stacks": "[python-api]",
        "license": "Apache-2.0",
        "migration_prefix": "bill",
    },
}

LEFTOVER = re.compile(r"(?<!\$)\{\{|\{%|%\}")
TEXT_SUFFIXES = {".md", ".py", ".sh", ".yml", ".yaml", ".json", ".toml", ".tf", ".ts", ".tsx", ".sql", ".txt", ""}


def run(cmd: list[str], cwd: Path, env: dict | None = None) -> tuple[bool, str]:
    t0 = time.monotonic()
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)
    took = time.monotonic() - t0
    out = (p.stdout + p.stderr).strip().splitlines()
    tail = "\n".join(out[-15:]) if p.returncode else (out[-1] if out else "")
    return p.returncode == 0, f"({took:.1f}s) {tail}"


def leftovers(project: Path) -> list[str]:
    found = []
    for p in project.rglob("*"):
        rel = p.relative_to(project).as_posix()
        if ".git/" in rel or "node_modules" in rel:
            continue
        if "{{" in rel or "{%" in rel:
            found.append(f"path {rel}")
        if p.is_file() and p.suffix in TEXT_SUFFIXES and not rel.startswith(("docs/templates/", "docs/playbook/", ".claude/skills/")):
            text = p.read_text(encoding="utf-8", errors="replace")
            for n, line in enumerate(text.splitlines(), start=1):
                if LEFTOVER.search(line) and "${{" not in line:
                    found.append(f"{rel}:{n}")
    return found


def render(variant: str, data: dict[str, str], dest: Path, copier: str) -> tuple[bool, str]:
    cmd = [copier, "copy", "--vcs-ref", "HEAD", "--defaults", "--quiet"]
    for k, v in data.items():
        cmd += ["--data", f"{k}={v}"]
    return run(cmd + [str(REPO), str(dest)], REPO)


def checks(
    project: Path, first: bool, venv: Path | None, actionlint: str | None, markdownlint: bool = False
) -> list[tuple[str, list[str], Path]]:
    py = sys.executable
    out = [
        ("links", [py, "tools/check_links.py", "."], project),
        ("resource-id lint", [py, "tools/resource_id_lint.py", "--mode", "error", "."], project),
        ("code health", [py, ".github/scripts/code_health.py"], project),
        ("hook settings", [py, ".claude/hooks/test_settings_hooks.py"], project),
    ]
    if first:
        out += [
            ("hook: subagent guardrails", ["bash", ".claude/hooks/test_subagent_guardrails_generic.sh"], project),
            ("hook: MCP guardrails", ["bash", ".claude/hooks/test_subagent_mcp_guardrails.sh"], project),
            ("hook: shell guard", [py, ".claude/hooks/test_shell_guard_core.py"], project),
        ]
    if (project / "api").is_dir() and venv:
        vpy = str(venv / "bin" / "python")
        out += [
            ("api ruff check", [vpy, "-m", "ruff", "check", "."], project / "api"),
            ("api ruff format", [vpy, "-m", "ruff", "format", "--check", "."], project / "api"),
            ("api pytest", [vpy, "-m", "pytest", "-q", "-p", "no:cacheprovider"], project / "api"),
        ]
    if (project / "lambda").is_dir():
        out.append(("lambda tests", [py, "-m", "unittest", "discover", "-s", "lambda", "-p", "test_*.py"], project))
    if (project / "web").is_dir() and shutil.which("node"):
        out.append(("web unit tests", ["node", "--test", "--experimental-strip-types", "lib/crossSite.test.ts"], project / "web"))
    if (project / "infra").is_dir() and shutil.which("terraform"):
        out.append(("terraform fmt", ["terraform", "fmt", "-check", "-recursive"], project / "infra"))
    if actionlint:
        out.append(("actionlint", [actionlint, "-no-color"], project))
    if markdownlint:
        out.append(("markdownlint", ["npx", "--yes", "markdownlint-cli2@0.23.2", "**/*.md"], project))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--variant", action="append", choices=sorted(VARIANTS))
    ap.add_argument("--keep", type=Path, help="render into this folder and keep the projects")
    ap.add_argument("--venv", type=Path, help="virtualenv with api/requirements-dev.txt installed")
    ap.add_argument("--actionlint", help="actionlint binary")
    ap.add_argument("--copier", default=shutil.which("copier") or "copier")
    ap.add_argument("--markdownlint", action="store_true", help="also run markdownlint-cli2 0.23.2 (npx) per variant")
    a = ap.parse_args(argv)
    base = a.keep or Path(tempfile.mkdtemp(prefix="render-matrix-"))
    failures = 0
    for i, name in enumerate(a.variant or list(VARIANTS)):
        dest = base / name
        if dest.exists():
            shutil.rmtree(dest)
        ok, msg = render(name, VARIANTS[name], dest, a.copier)
        print(f"[{name}] {'ok  ' if ok else 'FAIL'} render {msg}")
        if not ok:
            failures += 1
            continue
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=dest, check=True)
        left = leftovers(dest)
        print(f"[{name}] {'ok  ' if not left else 'FAIL'} no Jinja leftovers {left[:5]}")
        failures += bool(left)
        env = dict(os.environ)
        for label, cmd, cwd in checks(dest, i == 0, a.venv, a.actionlint, a.markdownlint):
            ok, msg = run(cmd, cwd, env)
            print(f"[{name}] {'ok  ' if ok else 'FAIL'} {label} {msg}")
            failures += not ok
    if not a.keep:
        shutil.rmtree(base, ignore_errors=True)
    print(f"render matrix: {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
