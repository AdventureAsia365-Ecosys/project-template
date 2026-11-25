"""Database-backed settings and job stores on a throwaway Postgres (skipped without TEST_DATABASE_URL)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.jobs import DONE, FAILED, QUEUED, RUNNING, PostgresJobStore, purge, run_once
from app.main import create_app
from app.settings_registry import PostgresSettingsStore, SettingError, SettingsRegistry
from app.wiring import ALL_SETTINGS, MULTI_TENANT, SCHEMA, build_stores, database_ready

T0 = datetime(2030, 1, 1, tzinfo=UTC)


def jobs(pool) -> PostgresJobStore:
    return PostgresJobStore(pool, SCHEMA, tenant_aware=MULTI_TENANT)


def registry(pool, **values: int) -> SettingsRegistry:
    reg = SettingsRegistry(PostgresSettingsStore(pool, SCHEMA), ALL_SETTINGS)
    for key, value in values.items():
        reg.set(key, value, changed_by="test")
    return reg


def test_settings_default_change_and_audit(pool):
    reg = registry(pool)
    assert reg.get("jobs.max_attempts") == 3
    entry = reg.set("jobs.max_attempts", 5, changed_by="administrator")
    assert (entry.old, entry.new) == (3, 5)
    assert SettingsRegistry(PostgresSettingsStore(pool, SCHEMA), ALL_SETTINGS).get("jobs.max_attempts") == 5
    reg.set("jobs.max_attempts", 7, changed_by="administrator")
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT old_value, new_value, changed_by FROM {SCHEMA}.settings_audit ORDER BY id"
        ).fetchall()
    assert rows == [(3, 5, "administrator"), (5, 7, "administrator")]
    with pytest.raises(SettingError):
        reg.set("jobs.max_attempts", 0, changed_by="administrator")


def test_enqueue_claim_finish(pool):
    store = jobs(pool)
    job = store.enqueue("greet", {"name": "Ada"}, run_after=T0)
    assert job.status == QUEUED and job.payload == {"name": "Ada"}
    claimed = store.claim(60, T0)
    assert claimed.id == job.id and claimed.status == RUNNING and claimed.attempts == 1
    assert store.claim(60, T0) is None
    assert store.busy_count(T0) == 1
    store.finish(claimed, DONE)
    assert store.busy_count(T0) == 0


def test_idempotency_key_adds_the_job_once(pool):
    store = jobs(pool)
    first = store.enqueue("report", {"month": "2030-01"}, idempotency_key="report-2030-01")
    again = store.enqueue("report", {"month": "other"}, idempotency_key="report-2030-01")
    assert again.id == first.id and again.payload == {"month": "2030-01"}
    assert store.busy_count(T0) == 1


def test_run_after_holds_a_job_back(pool):
    store = jobs(pool)
    store.enqueue("later", {}, run_after=T0 + timedelta(minutes=5))
    assert store.claim(60, T0) is None
    assert store.claim(60, T0 + timedelta(minutes=5)).kind == "later"


def test_expired_lease_is_claimed_again(pool):
    store = jobs(pool)
    store.enqueue("slow", {}, run_after=T0)
    store.claim(60, T0)
    assert store.claim(60, T0 + timedelta(seconds=30)) is None
    again = store.claim(60, T0 + timedelta(seconds=61))
    assert again.attempts == 2


def test_a_locked_row_is_skipped_not_waited_for(pool):
    store = jobs(pool)
    first = store.enqueue("a", {}, run_after=T0)
    second = store.enqueue("b", {}, run_after=T0)
    with pool.connection() as other, other.transaction():
        other.execute(f"SELECT id FROM {SCHEMA}.job WHERE id = %s FOR UPDATE", (first.id,))
        claimed = store.claim(60, T0)
    assert claimed.id == second.id


def test_run_once_retries_after_the_delay_then_fails(pool):
    store = jobs(pool)
    settings = registry(pool, **{"jobs.max_attempts": 2, "jobs.retry_delay_seconds": 60})
    store.enqueue("flaky", {}, run_after=T0)

    def boom(_):
        raise RuntimeError("upstream timeout")

    first = run_once(store, settings, {"flaky": boom}, now=T0)
    assert first.status == QUEUED and first.run_after == T0 + timedelta(seconds=60)
    assert run_once(store, settings, {"flaky": boom}, now=T0 + timedelta(seconds=30)) is None
    second = run_once(store, settings, {"flaky": boom}, now=T0 + timedelta(seconds=60))
    assert second.status == FAILED and second.attempts == 2 and "timeout" in second.error


def test_purge_removes_only_old_finished_jobs(pool):
    store = jobs(pool)
    store.enqueue("keep", {}, run_after=T0)
    done = store.enqueue("old", {}, run_after=T0)
    store.finish(done, DONE)
    with pool.connection() as conn:
        conn.execute(f"UPDATE {SCHEMA}.job SET finished_at = now() - interval '40 days' WHERE id = %s", (done.id,))
    assert purge(store, registry(pool)) == 1
    assert store.busy_count(T0) == 1


def test_wiring_and_readiness_use_the_database(pool):
    stores = build_stores(pool)
    stores.jobs.enqueue("noop", {})
    assert database_ready(pool)
    c = TestClient(create_app(jobs=stores.jobs, settings=stores.settings, ready_checks={"db": lambda: True}))
    assert c.get("/deploy-gate").json() == {"open": False, "busy_jobs": 1}
    assert c.get("/health/ready").json() == {"status": "ready", "checks": ["db"]}
