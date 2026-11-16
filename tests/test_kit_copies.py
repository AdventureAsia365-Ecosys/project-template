"""Tests of the copy guard, the copy sync and the leak scan (tools/kit_copies.py). Invented text only.

Run: python3 -m unittest discover -s tests -p 'test_*.py'
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import kit_copies  # noqa: E402
import kit_transform  # noqa: E402


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.source, self.repo = base / "source", base / "repo"
        (self.source / "docs").mkdir(parents=True)
        self.repo.mkdir()
        (self.source / "docs" / "page.md").write_text(
            "# Page\n\nGeneric line.\n<!-- kit:skip -->\nSource-only line.\n<!-- /kit:skip -->\n", encoding="utf-8"
        )
        (self.source / "run.sh").write_text("#!/bin/bash\necho hi\n", encoding="utf-8")
        self.sources = self.repo / "kit-sources.txt"
        self.sources.write_text("# list\ndocs/page.md template/docs/page.md\nrun.sh template/run.sh\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q"], cwd=self.source, check=True)
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-qm", "x", "--allow-empty"],
                       cwd=self.source, check=True)

    def tearDown(self):
        self.tmp.cleanup()

    def check(self) -> list[str]:
        return kit_copies.check(self.source, self.repo, self.sources)


class CopyGuardTest(Fixture):
    def test_sync_then_check_is_clean_and_records_the_commit(self):
        changed = kit_copies.sync(self.source, self.repo, self.sources)
        self.assertEqual(sorted(changed), ["template/docs/page.md", "template/run.sh"])
        self.assertEqual(self.check(), [])
        copy = (self.repo / "template/docs/page.md").read_text(encoding="utf-8")
        self.assertNotIn("Source-only", copy)
        self.assertRegex((self.repo / ".kit-source-ref").read_text(), r"^[0-9a-f]{40}\n$")
        self.assertTrue((self.repo / "template/run.sh").stat().st_mode & 0o111)

    def test_hand_edit_of_a_copy_fails(self):
        kit_copies.sync(self.source, self.repo, self.sources)
        (self.repo / "template/docs/page.md").write_text("# Page\n\nEdited by hand.\n", encoding="utf-8")
        errors = self.check()
        self.assertEqual(len(errors), 1)
        self.assertIn("differs from the transform", errors[0])

    def test_missing_copy_and_missing_source_fail(self):
        kit_copies.sync(self.source, self.repo, self.sources)
        (self.repo / "template/run.sh").unlink()
        (self.source / "docs/page.md").unlink()
        text = "\n".join(self.check())
        self.assertIn("template/run.sh: missing", text)
        self.assertIn("source docs/page.md does not exist", text)

    def test_source_change_fails_until_synced(self):
        kit_copies.sync(self.source, self.repo, self.sources)
        (self.source / "run.sh").write_text("#!/bin/bash\necho changed\n", encoding="utf-8")
        self.assertEqual(len(self.check()), 1)
        kit_copies.sync(self.source, self.repo, self.sources)
        self.assertEqual(self.check(), [])

    def test_dest_outside_the_repo_is_refused(self):
        self.sources.write_text("docs/page.md ../escape.md\n", encoding="utf-8")
        with self.assertRaises(SystemExit):
            self.check()


class LeakScanTest(unittest.TestCase):
    def test_findings_name_line_and_pattern_number_only(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            (base / "a.md").write_text("fine\nwe met Zorblax here\n", encoding="utf-8")
            (base / "zorblax-notes").mkdir()
            (base / "zorblax-notes" / "b.md").write_text("ok\n", encoding="utf-8")
            (base / ".git").mkdir()
            (base / ".git" / "c").write_text("Zorblax\n", encoding="utf-8")
            deny = base / "deny.txt"
            deny.write_text("# invented\n(?i)zorblax\n", encoding="utf-8")
            found = kit_copies.scan(base, kit_copies.load_denylist(deny))
            self.assertIn("a.md:2: matches denylist pattern #1", found)
            self.assertIn("zorblax-notes/b.md: the path matches denylist pattern #1", found)
            self.assertFalse(any(".git" in f for f in found))
            self.assertFalse(any("met" in f for f in found))

    def test_empty_denylist_is_a_usage_error(self):
        with tempfile.TemporaryDirectory() as d:
            deny = Path(d) / "deny.txt"
            deny.write_text("\n", encoding="utf-8")
            self.assertEqual(kit_copies.main(["scan", "--denylist", str(deny), d]), 2)


class HistoryScanTest(unittest.TestCase):
    def commit(self, repo: Path, name: str, email: str, message: str) -> None:
        subprocess.run(["git", "-c", f"user.name={name}", "-c", f"user.email={email}", "commit", "-q",
                        "--allow-empty", "-m", message], cwd=repo, check=True)

    def test_author_email_and_message_are_scanned_without_echoing_them(self):
        with tempfile.TemporaryDirectory() as d:
            repo, deny = Path(d) / "repo", Path(d) / "deny.txt"
            repo.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
            self.commit(repo, "Template Bot", "bot@example.test", "feat: a clean first commit")
            self.commit(repo, "Quillon Varga", "quillon@example.test", "fix: a second commit")
            self.commit(repo, "Template Bot", "bot@example.test", "docs: a page\n\nRefs ZRB-12")
            deny.write_text("# invented\n(?i)quillon\n\\bZRB-[0-9]+\n", encoding="utf-8")
            found = kit_copies.scan_history(repo, kit_copies.load_denylist(deny))
            fields = ("author name", "author e-mail", "committer name", "committer e-mail")
            for field in fields:
                self.assertEqual(sum(f"the {field} matches denylist pattern #1" in f for f in found), 1, field)
            self.assertEqual(sum("the message matches denylist pattern #2" in f for f in found), 1)
            self.assertEqual(len(found), 5)
            self.assertFalse(any("uillon" in f or "ZRB" in f for f in found))

    def test_clean_history_exits_zero(self):
        with tempfile.TemporaryDirectory() as d:
            repo, deny = Path(d) / "repo", Path(d) / "deny.txt"
            repo.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
            self.commit(repo, "Template Bot", "bot@example.test", "feat: clean")
            deny.write_text("(?i)quillon\n", encoding="utf-8")
            self.assertEqual(kit_copies.main(["scan-history", "--denylist", str(deny), str(repo)]), 0)


class RepoCopiesTest(unittest.TestCase):
    def test_every_listed_copy_exists_with_balanced_markers(self):
        for _, src, dest in kit_copies.read_pairs(kit_copies.SOURCES):
            path = REPO / dest
            self.assertTrue(path.is_file(), f"{dest} (copy of {src}) is missing")
            data = path.read_bytes()
            # A copy is already transformed: transforming it again must not change it.
            self.assertEqual(kit_transform.transform_bytes(data, dest), data, dest)


if __name__ == "__main__":
    unittest.main()
