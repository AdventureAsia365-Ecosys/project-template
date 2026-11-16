"""AWS Lambda function skeleton: one handler, no cloud call at import time, the commit SHA in every answer."""

from __future__ import annotations

import json
import os


def handler(event: dict, context: object) -> dict:
    name = (event or {}).get("name") or "world"
    body = {"message": f"hello {name}", "sha": os.environ.get("GIT_SHA", "unknown")}
    return {"statusCode": 200, "headers": {"content-type": "application/json"}, "body": json.dumps(body)}
