#!/usr/bin/env python3
"""Render matrix: generate the template with several answer sets and run each generated project's own checks.

Variants cover the defaults, every option on, the root-repo layout, the app-repo layout and a web-only project with
the optional parts off. For each one:
  - copier copy (the template at the working tree, so uncommitted changes are tested too);
  - no unrendered Jinja left in any file or path;
  - the optional parts (stop hook, personal-data guard, API contract check, UI smoke) are there exactly when their
    question says so, and the hooks are registered in .claude/settings.json;
  - the hook settings files (stop-open-work.json, pii-guard.json) equal their hook's DEFAULTS in a fresh project (the
    project's own tests check only their shape, since the project edits them);
  - the generated fast checks: links, resource-ID lint, code health, the hook settings test;
  - the stack checks the variant has: API ruff + pytest (one shared virtualenv), Lambda tests, web unit tests
    (node --test, no install), terraform fmt, actionlint over the generated workflows and markdownlint (each when
    its tool is given), the new hooks' tests and the API contract gate (with a real oasdiff when one is given: the
    exported document against itself passes, the same document with a route removed fails).
The guardrail red-team scripts run once (first variant): they are byte copies and slow to start.
--update-from <tag>: also generate the defaults from that release tag, commit, `copier update` to the working tree
and fail on any .rej file or conflict marker (a minor release must update an untouched project cleanly).

Usage: python3 tests/render_matrix.py [--variant NAME ...] [--keep DIR] [--venv DIR] [--actionlint BIN] [--markdownlint]
       [--oasdiff BIN] [--update-from TAG]
Exit 0 when every check of every variant passes.
"""

from __future__ import annotations

import argparse
import json
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
        "pii_guard": "false",
        "api_contract": "false",
    },
    "web-off": {
        "project_name": "Quiet Pages",
        "issue_key_prefix": "QP",
        "stacks": "[nextjs-web]",
        "cloud": "none",
        "ui_smoke": "false",
        "stop_hook": "false",
    },
}

# Optional parts: each path must exist exactly when its question is on (paths relative to the generated project).
HOOK_STOP = [".claude/hooks/stop-open-work.sh", ".claude/hooks/stop_open_work.py", ".claude/hooks/stop-open-work.json"]
HOOK_PII = [".claude/hooks/pii-guard.sh", ".claude/hooks/pii_guard.py", ".claude/hooks/pii-guard.json"]
API_CONTRACT = [
    ".github/workflows/api-contract.yml",
    ".github/scripts/openapi_breaking.sh",
    ".github/scripts/openapi_export.py",
    ".github/oasdiff/severity-levels.txt",
    "api/tests/test_openapi_export.py",
]
UI_SMOKE = [".github/workflows/ui-smoke.yml", "web/e2e/smoke.spec.ts", "web/playwright.config.ts", "web/lib/smokeRoutes.ts"]
EXPECT: dict[str, dict[str, bool]] = {
    "defaults": {"stop": True, "pii": True, "api": True, "smoke": True},
    "all-on": {"stop": True, "pii": True, "api": True, "smoke": True},
    "root": {"stop": False, "pii": True, "api": False, "smoke": False},
    "app": {"stop": True, "pii": False, "api": False, "smoke": False},
    "web-off": {"stop": False, "pii": True, "api": False, "smoke": False},
}
PARTS = {"stop": HOOK_STOP, "pii": HOOK_PII, "api": API_CONTRACT, "smoke": UI_SMOKE}
REGISTERED = {"stop": "stop-open-work.sh", "pii": "pii-guard.sh"}

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


def optional_parts(project: Path, want: dict[str, bool]) -> list[str]:
    """Paths that are there when their question is off, or missing when it is on; hooks missing from settings.json."""
    bad = []
    settings = (project / ".claude" / "settings.json").read_text(encoding="utf-8")
    package = project / "web" / "package.json"
    for part, paths in PARTS.items():
        for rel in paths:
            if (project / rel).exists() != want[part]:
                bad.append(f"{rel} {'missing' if want[part] else 'present'}")
        if part in REGISTERED and (REGISTERED[part] in settings) != want[part]:
            bad.append(f"settings.json {'lacks' if want[part] else 'registers'} {REGISTERED[part]}")
    if package.is_file() and ("@playwright/test" in package.read_text(encoding="utf-8")) != want["smoke"]:
        bad.append("web/package.json and the UI smoke answer disagree on @playwright/test")
    return bad


HOOK_SETTINGS = {"stop-open-work.json": "stop_open_work", "pii-guard.json": "pii_guard"}


def settings_match_defaults(project: Path) -> list[str]:
    """A fresh project's hook settings files equal their hook's DEFAULTS (the project's own tests only check the shape,
    because the project edits these files)."""
    bad = []
    hooks = project / ".claude" / "hooks"
    for name, module in HOOK_SETTINGS.items():
        if not (hooks / name).is_file():
            continue
        code = (
            "import json, sys; sys.path.insert(0, sys.argv[1]); m = __import__(sys.argv[2]); "
            "s = json.load(open(sys.argv[3], encoding='utf-8')); s.pop('_comment', None); "
            "sys.exit(0 if s == json.loads(json.dumps(m.DEFAULTS)) else 1)"
        )
        p = subprocess.run([sys.executable, "-c", code, str(hooks), module, str(hooks / name)], capture_output=True, text=True)
        if p.returncode:
            bad.append(f"{name} differs from {module}.DEFAULTS {p.stderr.strip()[-200:]}")
    return bad


def oasdiff_check(project: Path, venv: Path, oasdiff: str) -> tuple[bool, str]:
    """The real gate: the exported document against itself passes; with a route removed it fails."""
    work = Path(tempfile.mkdtemp(prefix="oasdiff-"))
    try:
        head = work / "head.json"
        ok, msg = run([str(venv / "bin" / "python"), ".github/scripts/openapi_export.py", "api", "--out", str(head)], project)
        if not ok:
            return False, f"export: {msg}"
        doc = json.loads(head.read_text(encoding="utf-8"))
        doc["paths"].pop("/deploy-gate")
        cut = work / "cut.json"
        cut.write_text(json.dumps(doc), encoding="utf-8")
        env = {**os.environ, "OASDIFF": oasdiff, "SEVERITY_LEVELS": ".github/oasdiff/severity-levels.txt",
               "INTERNAL_PATHS": "^/admin/", "BASE_SPEC": str(head), "HEAD_SPEC": str(head)}
        same = subprocess.run(["bash", ".github/scripts/openapi_breaking.sh"], cwd=project, env=env, capture_output=True, text=True)
        env["HEAD_SPEC"] = str(cut)
        broken = subprocess.run(["bash", ".github/scripts/openapi_breaking.sh"], cwd=project, env=env, capture_output=True, text=True)
        good = same.returncode == 0 and broken.returncode == 1 and "deploy-gate" in broken.stdout
        return good, f"same document exit {same.returncode}, route removed exit {broken.returncode}"
    finally:
        shutil.rmtree(work, ignore_errors=True)


def update_check(tag: str, dest: Path, copier: str) -> tuple[bool, str]:
    """Generate the defaults from <tag>, commit, update to the working tree: no .rej file, no conflict marker."""
    data = VARIANTS["defaults"]
    cmd = [copier, "copy", "--vcs-ref", tag, "--defaults", "--quiet"]
    for k, v in data.items():
        cmd += ["--data", f"{k}={v}"]
    ok, msg = run(cmd + [str(REPO), str(dest)], REPO)
    if not ok:
        return False, f"copy {tag}: {msg}"
    for git in (["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "chore: generate"]):
        subprocess.run(["git", *git], cwd=dest, check=True, capture_output=True)
    ok, msg = run([copier, "update", "--vcs-ref", "HEAD", "--defaults", "--quiet"], dest)
    if not ok:
        return False, f"update: {msg}"
    rej = [p.relative_to(dest).as_posix() for p in dest.rglob("*.rej")]
    marks = [
        p.relative_to(dest).as_posix()
        for p in dest.rglob("*")
        if p.is_file() and ".git/" not in p.as_posix() and "<<<<<<< " in p.read_text(encoding="utf-8", errors="replace")
    ]
    changed = subprocess.run(["git", "status", "--porcelain"], cwd=dest, capture_output=True, text=True).stdout
    return not rej and not marks, f"{len(changed.splitlines())} path(s) changed, .rej {rej[:5]}, conflicts {marks[:5]}"


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
    if (project / ".claude/hooks/test_stop_open_work.py").is_file():
        out.append(("hook: stop open work", [py, ".claude/hooks/test_stop_open_work.py"], project))
    if (project / ".claude/hooks/test_pii_guard.py").is_file():
        out.append(("hook: personal-data guard", [py, ".claude/hooks/test_pii_guard.py"], project))
    if (project / ".github/scripts/test_openapi_breaking.py").is_file():
        out.append(("api contract gate", [py, ".github/scripts/test_openapi_breaking.py"], project))
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
        tests = sorted(p.relative_to(project / "web").as_posix() for p in (project / "web" / "lib").glob("*.test.ts"))
        out.append(("web unit tests", ["node", "--test", "--experimental-strip-types", *tests], project / "web"))
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
    ap.add_argument("--oasdiff", help="oasdiff binary: run the API contract gate for real (needs --venv)")
    ap.add_argument("--update-from", help="release tag to update the defaults from (copier update, no conflict)")
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
        bad = optional_parts(dest, EXPECT[name])
        print(f"[{name}] {'ok  ' if not bad else 'FAIL'} optional parts match the answers {bad[:5]}")
        failures += bool(bad)
        drift = settings_match_defaults(dest)
        print(f"[{name}] {'ok  ' if not drift else 'FAIL'} hook settings files equal the code defaults {drift[:5]}")
        failures += bool(drift)
        if a.oasdiff and a.venv and (dest / ".github/scripts/openapi_breaking.sh").is_file():
            ok, msg = oasdiff_check(dest, a.venv, a.oasdiff)
            print(f"[{name}] {'ok  ' if ok else 'FAIL'} api contract with oasdiff {msg}")
            failures += not ok
        env = dict(os.environ)
        for label, cmd, cwd in checks(dest, i == 0, a.venv, a.actionlint, a.markdownlint):
            ok, msg = run(cmd, cwd, env)
            print(f"[{name}] {'ok  ' if ok else 'FAIL'} {label} {msg}")
            failures += not ok
    if a.update_from:
        dest = base / "update"
        if dest.exists():
            shutil.rmtree(dest)
        ok, msg = update_check(a.update_from, dest, a.copier)
        print(f"[update] {'ok  ' if ok else 'FAIL'} copier update from {a.update_from} {msg}")
        failures += not ok
    if not a.keep:
        shutil.rmtree(base, ignore_errors=True)
    print(f"render matrix: {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
