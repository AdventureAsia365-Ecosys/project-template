"""Job table and worker: background work is a row in the job table, claimed by one worker at a time.

A job is queued, claimed (running, with a lease), then done or failed. A worker that dies leaves its lease to expire,
and another worker takes the job again; after `jobs.max_attempts` attempts the job is failed. Both limits are
settings (settings_registry.py), not literals. The deploy gate (deploy_gate.py) refuses a deploy while any job is
queued or running.

`MemoryJobStore` serves tests and local runs; deployed environments use the job table of migration 001 with
`FOR UPDATE SKIP LOCKED` claims (the SQL is in CLAIM_SQL below).

Run a worker: python -m app.jobs
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Protocol

from .settings_registry import SettingsRegistry

QUEUED, RUNNING, DONE, FAILED = "queued", "running", "done", "failed"

CLAIM_SQL = """
UPDATE {schema}.job SET status = 'running', attempts = attempts + 1, lease_until = now() + make_interval(secs => $1)
WHERE id = (
  SELECT id FROM {schema}.job
  WHERE status = 'queued' OR (status = 'running' AND lease_until < now())
  ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
)
RETURNING id, kind, payload, attempts
"""


@dataclass
class Job:
    id: int
    kind: str
    payload: dict
    status: str = QUEUED
    attempts: int = 0
    lease_until: datetime | None = None
    error: str | None = None


class JobStore(Protocol):
    def enqueue(self, kind: str, payload: dict) -> Job: ...

    def claim(self, lease_seconds: int, now: datetime) -> Job | None: ...

    def finish(self, job: Job, status: str, error: str | None = None) -> None: ...

    def busy_count(self, now: datetime) -> int: ...


@dataclass
class MemoryJobStore:
    jobs: list[Job] = field(default_factory=list)

    def enqueue(self, kind: str, payload: dict) -> Job:
        job = Job(id=len(self.jobs) + 1, kind=kind, payload=payload)
        self.jobs.append(job)
        return job

    def claim(self, lease_seconds: int, now: datetime) -> Job | None:
        for job in self.jobs:
            expired = job.status == RUNNING and job.lease_until is not None and job.lease_until < now
            if job.status == QUEUED or expired:
                job.status, job.attempts = RUNNING, job.attempts + 1
                job.lease_until = now + timedelta(seconds=lease_seconds)
                return job
        return None

    def finish(self, job: Job, status: str, error: str | None = None) -> None:
        job.status, job.error, job.lease_until = status, error, None

    def busy_count(self, now: datetime) -> int:
        return sum(1 for j in self.jobs if j.status in (QUEUED, RUNNING))


Handler = Callable[[dict], None]


def run_once(
    store: JobStore, settings: SettingsRegistry, handlers: dict[str, Handler], now: datetime | None = None
) -> Job | None:
    """Claim one job and run its handler. Returns the job, or None when the queue is empty."""
    now = now or datetime.now(UTC)
    job = store.claim(settings.get("jobs.lease_seconds"), now)
    if job is None:
        return None
    if job.attempts > settings.get("jobs.max_attempts"):
        store.finish(job, FAILED, "too many attempts")
        return job
    handler = handlers.get(job.kind)
    if handler is None:
        store.finish(job, FAILED, f"no handler for kind {job.kind}")
        return job
    try:
        handler(job.payload)
    except Exception as e:  # noqa: BLE001 - a failed job is recorded, the worker goes on
        status = FAILED if job.attempts >= settings.get("jobs.max_attempts") else QUEUED
        store.finish(job, status, str(e)[:500])
        return job
    store.finish(job, DONE)
    return job


HANDLERS: dict[str, Handler] = {
    "noop": lambda payload: None,
}


def main() -> None:  # pragma: no cover - the deployed worker loop
    from .settings_registry import MemorySettingsStore

    store, settings = MemoryJobStore(), SettingsRegistry(MemorySettingsStore())
    while True:
        if run_once(store, settings, HANDLERS) is None:
            time.sleep(2)


if __name__ == "__main__":  # pragma: no cover
    main()
