"""The Playwright pins of the template agree: the UAT harness, the UI smoke and the kit CI's web end-to-end job install
one version, so the browser build CI downloads is the one every run uses. Also: the UI kit and the UAT harness keep the
TypeScript and Node type pins of the web skeleton, and Next.js stays on an exact version at or above the release that
fixed the advisories published against 16.4.2 (1.3.1).

Run: python3 -m unittest discover -s tests -p 'test_*.py'
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WEB_PACKAGE = REPO / "template" / "{% if has_web %}web{% endif %}" / "package.json.jinja"
UAT_PACKAGE = REPO / "template" / "tools" / "{% if has_web %}uat{% endif %}" / "package.json"
KIT_CI = REPO / ".github" / "workflows" / "kit-ci.yml"
# The first Next.js release with no published advisory against it in the 16.4 line (1.3.1 moved the pin here).
NEXT_FLOOR = (16, 4, 5)


def pin(text: str, name: str) -> str:
    m = re.search(rf'"{re.escape(name)}":\s*"([^"]+)"', text)
    if not m:
        raise AssertionError(f"{name} is not pinned")
    return m.group(1)


class PinsTest(unittest.TestCase):
    def test_playwright_is_one_version(self):
        uat = json.loads(UAT_PACKAGE.read_text(encoding="utf-8"))["devDependencies"]
        web = WEB_PACKAGE.read_text(encoding="utf-8")
        ci = re.search(r"^\s*PLAYWRIGHT_VERSION:\s*(\S+)", KIT_CI.read_text(encoding="utf-8"), re.M)
        self.assertIsNotNone(ci, "kit-ci.yml sets PLAYWRIGHT_VERSION")
        self.assertEqual(uat["playwright"], pin(web, "@playwright/test"))
        self.assertEqual(uat["playwright"], ci.group(1))

    def test_uat_shares_the_web_toolchain_pins(self):
        uat = json.loads(UAT_PACKAGE.read_text(encoding="utf-8"))["devDependencies"]
        web = WEB_PACKAGE.read_text(encoding="utf-8")
        for name in ("typescript", "@types/node"):
            self.assertEqual(uat[name], pin(web, name), name)
        for name, version in uat.items():
            self.assertRegex(version, r"^\d+\.\d+\.\d+$", f"{name} is an exact version")

    def test_next_is_exact_and_patched(self):
        version = pin(WEB_PACKAGE.read_text(encoding="utf-8"), "next")
        self.assertRegex(version, r"^\d+\.\d+\.\d+$", "next is an exact version")
        self.assertGreaterEqual(tuple(int(part) for part in version.split(".")), NEXT_FLOOR, version)


if __name__ == "__main__":
    unittest.main()
