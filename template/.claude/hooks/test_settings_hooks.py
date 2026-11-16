"""Every hook .claude/settings.json registers exists, is executable and has its tests.

A broken hook path fails open (the agent reports a hook error and goes on) or blocks every call, and nobody notices.
Run: python3 .claude/hooks/test_settings_hooks.py
"""

from __future__ import annotations

import json
import os
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SETTINGS = ROOT / ".claude" / "settings.json"
HOOKS = ROOT / ".claude" / "hooks"
KNOWN_TOOLS = {"Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "Read", "Workflow", "Agent", "Task", "WebFetch"}
# A wrapper and the module it runs share one test file.
TESTS_OF = {"shell_guard": "test_shell_guard_core", "subagent_guardrails": "test_subagent_guardrails"}


def registered() -> list[tuple[str, str]]:
    data = json.loads(SETTINGS.read_text(encoding="utf-8"))
    out = []
    for entries in (data.get("hooks") or {}).values():
        for entry in entries:
            for h in entry.get("hooks") or []:
                out.append((entry.get("matcher", ""), h.get("command", "")))
    return out


class SettingsHooksTest(unittest.TestCase):
    def test_every_registered_hook_exists_and_is_executable(self):
        hooks = registered()
        self.assertGreater(len(hooks), 0)
        for _, cmd in hooks:
            m = re.fullmatch(r'"\$CLAUDE_PROJECT_DIR"/(\.claude/hooks/[\w.-]+)', cmd)
            self.assertIsNotNone(m, f'hook command must be "$CLAUDE_PROJECT_DIR"/.claude/hooks/<file>: {cmd}')
            path = ROOT / m.group(1)
            self.assertTrue(path.is_file(), f"missing hook {path}")
            self.assertTrue(os.access(path, os.X_OK), f"hook not executable: {path}")

    def test_matchers_name_real_tools(self):
        for matcher, _ in registered():
            for part in filter(None, matcher.split("|")):
                self.assertTrue(part in KNOWN_TOOLS or part.startswith("mcp__"), f"unknown matcher tool '{part}'")

    def test_every_hook_has_a_test(self):
        tests = {p.name for p in HOOKS.glob("test_*")}
        for _, cmd in registered():
            stem = Path(cmd.split("/")[-1]).stem.replace("-", "_")
            want = TESTS_OF.get(stem, f"test_{stem}")
            self.assertTrue(any(t.startswith(want) for t in tests), f"no {want}* for {cmd}")


if __name__ == "__main__":
    unittest.main()
