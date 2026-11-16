"""Run: python3 -m unittest discover -s lambda -p 'test_*.py'. Invented names only."""

from __future__ import annotations

import json
import os
import unittest
from unittest import mock

from handler import handler


class HandlerTest(unittest.TestCase):
    def test_greets_and_reports_the_commit(self):
        with mock.patch.dict(os.environ, {"GIT_SHA": "abc1234"}):
            out = handler({"name": "Ada"}, None)
        self.assertEqual(out["statusCode"], 200)
        self.assertEqual(json.loads(out["body"]), {"message": "hello Ada", "sha": "abc1234"})

    def test_empty_event(self):
        self.assertIn("hello world", handler({}, None)["body"])


if __name__ == "__main__":
    unittest.main()
