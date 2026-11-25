"""Job table and worker: background work is a row in the job table, claimed by one worker at a time.

A job is queued, claimed (running, with a lease), then done or failed. A worker that dies leaves its lease to expire,
and another worker takes the job again; after `jobs.max_attempts` attempts the job is failed. A failed attempt waits
`jobs.retry_delay_seconds` before the next one (`run_after`). Every limit is a setting (settings_registry.py), not a
literal. The deploy gate (main.py) refuses a deploy while any job is queued or running.

Enqueue with an idempotency key to make a retried request add the job once: a second enqueue with the same key returns
the first job. A job may carry a tenant; with a per-tenant limit (multi-tenant projects: the setting
`jobs.max_running_per_tenant`), a claim skips the jobs of a tenant that already holds that many running jobs, so one
tenant cannot take every worker (the fair-share gate).

`MemoryJobStore` serves tests and local runs; `PostgresJobStore` is the job table of migrations 001 and 002, claimed
with `FOR UPDATE SKIP LOCKED` so two workers never take the same row.

Run a worker: python -m app.jobs
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .settings_registry import SettingsRegistry

QUEUED, RUNNING, DONE, FAILED = "queued", "running", "done", "failed"
FINISHED = (DONE, FAILED)
PER_TENANT_LIMIT = "jobs.max_running_per_tenant"


@dataclass
class Job:
    id: int
    kind: str
    payload: dict
    status: str = QUEUED
    attempts: int = 0
    lease_until: datetime | None = None
    error: str | None = None
    idempotency_key: str | None = None
    run_after: datetime | None = None
    tenant_id: str | None = None
    finished_at: datetime | None = None


class JobStore(Protocol):
    def enqueue(
        self,
        kind: str,
        payload: dict,
        *,
        idempotency_key: str | None = None,
        run_after: datetime | None = None,
        tenant_id: str | None = None,
    ) -> Job: ...

    def claim(self, lease_seconds: int, now: datetime, *, per_tenant_limit: int | None = None) -> Job | None: ...

    def finish(self, job: Job, status: str, error: str | None = None, *, run_after: datetime | None = None) -> None: ...

    def busy_count(self, now: datetime) -> int: ...

    def purge_finished(self, before: datetime) -> int: ...


def _claimable(job: Job, now: datetime) -> bool:
    expired = job.status == RUNNING and job.lease_until is not None and job.lease_until < now
    due = job.run_after is None or job.run_after <= now
    return (job.status == QUEUED or expired) and due


@dataclass
class MemoryJobStore:
    jobs: list[Job] = field(default_factory=list)

    def enqueue(
        self,
        kind: str,
        payload: dict,
        *,
        idempotency_key: str | None = None,
        run_after: datetime | None = None,
        tenant_id: str | None = None,
    ) -> Job:
        if idempotency_key is not None:
            for job in self.jobs:
                if job.idempotency_key == idempotency_key:
                    return job
        job = Job(len(self.jobs) + 1, kind, payload, idempotency_key=idempotency_key, run_after=run_after)
        job.tenant_id = tenant_id
        self.jobs.append(job)
        return job

    def _running(self, tenant_id: str, now: datetime) -> int:
        live = (j for j in self.jobs if j.status == RUNNING and j.lease_until is not None and j.lease_until >= now)
        return sum(1 for j in live if j.tenant_id == tenant_id)

    def claim(self, lease_seconds: int, now: datetime, *, per_tenant_limit: int | None = None) -> Job | None:
        for job in self.jobs:
            if not _claimable(job, now):
                continue
            if per_tenant_limit is not None and job.tenant_id is not None:
                if self._running(job.tenant_id, now) >= per_tenant_limit:
                    continue
            job.status, job.attempts = RUNNING, job.attempts + 1
            job.lease_until = now + timedelta(seconds=lease_seconds)
            return job
        return None

    def finish(self, job: Job, status: str, error: str | None = None, *, run_after: datetime | None = None) -> None:
        job.status, job.error, job.lease_until = status, error, None
        if run_after is not None:
            job.run_after = run_after
        job.finished_at = datetime.now(UTC) if status in FINISHED else None

    def busy_count(self, now: datetime) -> int:
        return sum(1 for j in self.jobs if j.status in (QUEUED, RUNNING))

    def purge_finished(self, before: datetime) -> int:
        old = [j for j in self.jobs if j.status in FINISHED and j.finished_at is not None and j.finished_at < before]
        self.jobs[:] = [j for j in self.jobs if j not in old]
        return len(old)


_COLUMNS = "id, kind, payload, status, attempts, lease_until, error, idempotency_key, run_after, finished_at"
_RETURNING = "RETURNING " + _COLUMNS + "{tenant}"
_BY_KEY = "SELECT " + _COLUMNS + "{tenant} FROM {schema}.job WHERE idempotency_key = %(key)s"
_DUE = "(j.status = 'queued' OR (j.status = 'running' AND j.lease_until < %(now)s)) AND j.run_after <= %(now)s"
_CLAIMED = """
UPDATE {schema}.job SET status = 'running', attempts = attempts + 1,
  lease_until = %(now)s + make_interval(secs => %(lease)s)
WHERE id = (
  SELECT j.id FROM {schema}.job j
  WHERE """

CLAIM_SQL = (
    _CLAIMED
    + _DUE
    + """
  ORDER BY j.created_at, j.id FOR UPDATE SKIP LOCKED LIMIT 1
)
"""
    + _RETURNING
)

# Fair-share claim: claims are serialised by a transaction-scoped advisory lock, so the running count a claim reads
# cannot change under it (two workers would otherwise both see "one slot left" and both take it).
FAIR_CLAIM_SQL = (
    _CLAIMED
    + _DUE
    + """
    AND (j.tenant_id IS NULL OR (
      SELECT count(*) FROM {schema}.job r
      WHERE r.tenant_id = j.tenant_id AND r.status = 'running' AND r.lease_until >= %(now)s
    ) < %(limit)s)
  ORDER BY j.created_at, j.id FOR UPDATE SKIP LOCKED LIMIT 1
)
"""
    + _RETURNING
)


class PostgresJobStore:
    """The job table. `tenant_aware` is True in multi-tenant projects, whose migration 002 adds `job.tenant_id`."""

    def __init__(self, pool: Any, schema: str, *, tenant_aware: bool = False) -> None:
        self._pool, self._schema, self._tenant_aware = pool, schema, tenant_aware

    def _sql(self, text: str) -> sql.Composed:
        tenant = ", tenant_id" if self._tenant_aware else ""
        return sql.SQL(text.replace("{tenant}", tenant)).format(schema=sql.Identifier(self._schema))

    def _job(self, row: dict) -> Job:
        tenant = row.pop("tenant_id", None)
        job = Job(**row)
        job.tenant_id = None if tenant is None else str(tenant)
        return job

    def enqueue(
        self,
        kind: str,
        payload: dict,
        *,
        idempotency_key: str | None = None,
        run_after: datetime | None = None,
        tenant_id: str | None = None,
    ) -> Job:
        if tenant_id is not None and not self._tenant_aware:
            raise ValueError("this job table has no tenant column")
        insert = self._sql(
            "INSERT INTO {schema}.job (kind, payload, idempotency_key, run_after{tenant}) "
            "VALUES (%(kind)s, %(payload)s, %(key)s, coalesce(%(run_after)s::timestamptz, now())"
            + (", %(tenant)s" if self._tenant_aware else "")
            + ") ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING "
            + _RETURNING
        )
        args = {"kind": kind, "payload": Jsonb(payload), "key": idempotency_key, "run_after": run_after}
        args["tenant"] = tenant_id
        with self._pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            row = cur.execute(insert, args).fetchone()
            if row is None:  # the key was used before: hand back that job
                row = cur.execute(self._sql(_BY_KEY), args).fetchone()
        return self._job(row)

    def claim(self, lease_seconds: int, now: datetime, *, per_tenant_limit: int | None = None) -> Job | None:
        fair = self._tenant_aware and per_tenant_limit is not None
        args = {"now": now, "lease": lease_seconds, "limit": per_tenant_limit, "lock": f"{self._schema}.job.claim"}
        with self._pool.connection() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
            if fair:
                cur.execute("SELECT pg_advisory_xact_lock(hashtext(%(lock)s))", args)
            row = cur.execute(self._sql(FAIR_CLAIM_SQL if fair else CLAIM_SQL), args).fetchone()
        return None if row is None else self._job(row)

    def finish(self, job: Job, status: str, error: str | None = None, *, run_after: datetime | None = None) -> None:
        update = self._sql(
            "UPDATE {schema}.job SET status = %(status)s, error = %(error)s, lease_until = NULL, "
            "run_after = coalesce(%(run_after)s::timestamptz, run_after), "
            "finished_at = CASE WHEN %(status)s IN ('done', 'failed') THEN now() END WHERE id = %(id)s"
        )
        with self._pool.connection() as conn:
            conn.execute(update, {"status": status, "error": error, "run_after": run_after, "id": job.id})
        job.status, job.error, job.lease_until = status, error, None
        if run_after is not None:
            job.run_after = run_after

    def busy_count(self, now: datetime) -> int:
        count = self._sql("SELECT count(*) FROM {schema}.job WHERE status IN ('queued', 'running')")
        with self._pool.connection() as conn:
            return int(conn.execute(count).fetchone()[0])

    def purge_finished(self, before: datetime) -> int:
        delete = self._sql("DELETE FROM {schema}.job WHERE status IN ('done', 'failed') AND finished_at < %(before)s")
        with self._pool.connection() as conn:
            return conn.execute(delete, {"before": before}).rowcount


Handler = Callable[[dict], None]


def _limit(settings: SettingsRegistry) -> int | None:
    return settings.get(PER_TENANT_LIMIT) if settings.has(PER_TENANT_LIMIT) else None


def run_once(
    store: JobStore, settings: SettingsRegistry, handlers: dict[str, Handler], now: datetime | None = None
) -> Job | None:
    """Claim one job and run its handler. Returns the job, or None when no job is due.

    A tenant job's handler finds the tenant in `payload["tenant_id"]`."""
    now = now or datetime.now(UTC)
    job = store.claim(settings.get("jobs.lease_seconds"), now, per_tenant_limit=_limit(settings))
    if job is None:
        return None
    if job.attempts > settings.get("jobs.max_attempts"):
        store.finish(job, FAILED, "too many attempts")
        return job
    handler = handlers.get(job.kind)
    if handler is None:
        store.finish(job, FAILED, f"no handler for kind {job.kind}")
        return job
    payload = job.payload if job.tenant_id is None else {**job.payload, "tenant_id": job.tenant_id}
    try:
        handler(payload)
    except Exception as e:  # noqa: BLE001 - a failed job is recorded, the worker goes on
        if job.attempts >= settings.get("jobs.max_attempts"):
            store.finish(job, FAILED, str(e)[:500])
        else:
            retry_at = now + timedelta(seconds=settings.get("jobs.retry_delay_seconds"))
            store.finish(job, QUEUED, str(e)[:500], run_after=retry_at)
        return job
    store.finish(job, DONE)
    return job


def purge(store: JobStore, settings: SettingsRegistry, now: datetime | None = None) -> int:
    """Delete finished jobs older than the `jobs.retention_days` setting. Returns how many went."""
    now = now or datetime.now(UTC)
    return store.purge_finished(now - timedelta(days=settings.get("jobs.retention_days")))


HANDLERS: dict[str, Handler] = {
    "noop": lambda payload: None,
}


def main() -> None:  # pragma: no cover - the deployed worker loop
    from .wiring import build_stores, pool_from_env

    pool = pool_from_env()
    if pool is not None:
        pool.open()
    stores = build_stores(pool)
    last_purge = 0.0
    while True:
        if time.monotonic() - last_purge > 3600:
            purge(stores.jobs, stores.settings)
            last_purge = time.monotonic()
        if run_once(stores.jobs, stores.settings, HANDLERS) is None:
            time.sleep(2)


if __name__ == "__main__":  # pragma: no cover
    main()
