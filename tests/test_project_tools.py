"""Tests of the generated project's own tools (template/tools, template/.github/scripts). Invented values only; the
ID-shaped samples below are built at run time so this file itself passes the resource-ID lint.

Run: python3 -m unittest discover -s tests -p 'test_*.py'
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parents[1] / "template"


def load(rel: str):
    path = TEMPLATE / rel
    spec = importlib.util.spec_from_file_location(path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


rid = load("tools/resource_id_lint.py")
links = load("tools/check_links.py")
health = load(".github/scripts/code_health.py")
ratchet = load(".github/scripts/coverage_ratchet.py")


class ResourceIdLintTest(unittest.TestCase):
    def kinds(self, text: str) -> list[str]:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "page.md"
            p.write_text(text, encoding="utf-8")
            return [k for _, k in rid.findings(p)]

    def test_each_kind_is_found(self):
        acct = "1234" * 3
        samples = {
            "account": f"the account {acct} is ours",
            "arn": f"arn:aws:iam::{acct}:role/deploy",
            "vpc": "sg-" + "0a1b2c3d",
            "user-pool": "us-west-2_" + "AbCdEfGh1",
            "apigw": "abcde12345" + ".execute-api.us-east-1.amazonaws.com",
            "key": "AKIA" + "ABCDEFGHIJKLMNOP",
        }
        for kind, text in samples.items():
            self.assertEqual(self.kinds(text), [kind], kind)

    def test_ordinary_numbers_and_ignored_lines_pass(self):
        self.assertEqual(self.kinds("version 1.2.3, port 8000, 2026-11-16, id 42\n"), [])
        self.assertEqual(self.kinds("sg-" + "0a1b2c3d resource-id-lint: ignore\n"), [])
        self.assertEqual(self.kinds("a sha " + "0123456789ab" + "cdef in a hash\n"), [])


class LinksTest(unittest.TestCase):
    def test_broken_and_ok_links(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            (base / "b.md").write_text("# B\n", encoding="utf-8")
            (base / "a.md").write_text(
                "[ok](b.md) [anchor](b.md#x) [web](https://example.test) [bad](missing.md)\n"
                "`[code](nope.md)`\n```\n[fenced](nope.md)\n```\n",
                encoding="utf-8",
            )
            self.assertEqual(links.broken_links(base / "a.md"), [(1, "missing.md")])


class CodeHealthTest(unittest.TestCase):
    def test_complex_function_fails_until_baselined_and_stale_baseline_fails(self):
        branches = "\n".join(f"    if x == {i}:\n        return {i}" for i in range(12))
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "m.py").write_text(f"def f(x):\n{branches}\n    return -1\n", encoding="utf-8")
            cfg = {"max_complexity": 10, "max_file_lines": 800, "extensions": [".py"], "exclude_dirs": [], "baseline": {}}
            over = health.measure(root, cfg)
            self.assertEqual(over, {"m.py::f": ("complexity", 13)})
            conf = root / "c.json"
            conf.write_text(json.dumps(cfg), encoding="utf-8")
            self.assertEqual(health.main(["--config", str(conf), "--root", str(root)]), 1)
            cfg["baseline"] = {"m.py::f": 13}
            conf.write_text(json.dumps(cfg), encoding="utf-8")
            self.assertEqual(health.main(["--config", str(conf), "--root", str(root)]), 0)
            cfg["baseline"] = {"m.py::f": 20}
            conf.write_text(json.dumps(cfg), encoding="utf-8")
            self.assertEqual(health.main(["--config", str(conf), "--root", str(root)]), 1)


class CoverageRatchetTest(unittest.TestCase):
    def test_floor_only_rises(self):
        with tempfile.TemporaryDirectory() as d:
            report = Path(d) / "coverage.xml"
            ratchet.FLOOR = Path(d) / "floor.json"
            report.write_text('<coverage line-rate="0.8"/>', encoding="utf-8")
            self.assertEqual(ratchet.main(["raise", "api", str(report)]), 0)
            self.assertEqual(json.loads(ratchet.FLOOR.read_text())["api"], 80.0)
            report.write_text('<coverage line-rate="0.7"/>', encoding="utf-8")
            self.assertEqual(ratchet.main(["check", "api", str(report)]), 1)
            self.assertEqual(ratchet.main(["raise", "api", str(report)]), 0)
            self.assertEqual(json.loads(ratchet.FLOOR.read_text())["api"], 80.0)


if __name__ == "__main__":
    unittest.main()
