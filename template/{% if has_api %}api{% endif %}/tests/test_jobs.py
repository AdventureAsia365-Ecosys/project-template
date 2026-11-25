"""Job table semantics on the memory store: claim, lease expiry, retries bounded by the settings registry,
idempotency keys, run_after and the per-tenant limit (the database store has the same tests in test_pg_stores.py)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.jobs import DONE, FAILED, QUEUED, RUNNING, MemoryJobStore, purge, run_once
from app.settings_registry import SETTINGS, MemorySettingsStore, Setting, SettingsRegistry

T0 = datetime(2030, 1, 1, tzinfo=UTC)


def registry(**values: int) -> SettingsRegistry:
    return SettingsRegistry(MemorySettingsStore(values=dict(values)))


def test_empty_queue_returns_none():
    assert run_once(MemoryJobStore(), registry(), {}, now=T0) is None


def test_job_runs_once_and_is_done():
    store, seen = MemoryJobStore(), []
    store.enqueue("greet", {"name": "Ada"})
    job = run_once(store, registry(), {"greet": lambda p: seen.append(p["name"])}, now=T0)
    assert job.status == DONE and seen == ["Ada"]
    assert run_once(store, registry(), {}, now=T0) is None


def test_unknown_kind_fails_with_a_reason():
    store = MemoryJobStore()
    store.enqueue("mystery", {})
    job = run_once(store, registry(), {}, now=T0)
    assert job.status == FAILED and "no handler" in job.error


def test_failure_retries_until_the_max_attempts_setting():
    store = MemoryJobStore()
    store.enqueue("flaky", {})
    settings = registry(**{"jobs.max_attempts": 2})

    def boom(_):
        raise RuntimeError("upstream timeout")

    first = run_once(store, settings, {"flaky": boom}, now=T0)
    assert first.status == QUEUED and first.attempts == 1
    assert first.run_after == T0 + timedelta(seconds=30)  # jobs.retry_delay_seconds
    assert run_once(store, settings, {"flaky": boom}, now=T0 + timedelta(seconds=29)) is None
    second = run_once(store, settings, {"flaky": boom}, now=T0 + timedelta(seconds=30))
    assert second.status == FAILED and second.attempts == 2 and "timeout" in second.error


def test_expired_lease_is_claimed_again():
    store = MemoryJobStore()
    store.enqueue("slow", {})
    job = store.claim(lease_seconds=60, now=T0)
    assert job.status == RUNNING
    assert store.claim(lease_seconds=60, now=T0 + timedelta(seconds=30)) is None
    again = store.claim(lease_seconds=60, now=T0 + timedelta(seconds=61))
    assert again is job and again.attempts == 2


def test_busy_count_covers_queued_and_running():
    store = MemoryJobStore()
    store.enqueue("a", {})
    store.enqueue("b", {})
    store.claim(lease_seconds=60, now=T0)
    assert store.busy_count(T0) == 2


def test_idempotency_key_adds_the_job_once():
    store = MemoryJobStore()
    first = store.enqueue("report", {"month": "2030-01"}, idempotency_key="report-2030-01")
    again = store.enqueue("report", {"month": "other"}, idempotency_key="report-2030-01")
    assert again is first and len(store.jobs) == 1


def test_run_after_holds_a_job_back():
    store = MemoryJobStore()
    store.enqueue("later", {}, run_after=T0 + timedelta(minutes=5))
    assert store.claim(lease_seconds=60, now=T0) is None
    assert store.claim(lease_seconds=60, now=T0 + timedelta(minutes=5)).kind == "later"


PER_TENANT = SETTINGS + (Setting("jobs.max_running_per_tenant", 1, 1, 100, "Fair-share limit (test)."),)


def test_per_tenant_limit_lets_other_tenants_through():
    store, seen = MemoryJobStore(), []
    store.enqueue("work", {"n": 1}, tenant_id="tenant-a")
    store.enqueue("work", {"n": 2}, tenant_id="tenant-a")
    store.enqueue("work", {"n": 3}, tenant_id="tenant-b")
    first = store.claim(lease_seconds=60, now=T0, per_tenant_limit=1)
    second = store.claim(lease_seconds=60, now=T0, per_tenant_limit=1)
    assert (first.tenant_id, second.tenant_id) == ("tenant-a", "tenant-b")
    assert store.claim(lease_seconds=60, now=T0, per_tenant_limit=1) is None
    store.finish(first, DONE)
    settings = SettingsRegistry(MemorySettingsStore(), PER_TENANT)
    job = run_once(store, settings, {"work": seen.append}, now=T0)
    assert job.payload == {"n": 2} and seen == [{"n": 2, "tenant_id": "tenant-a"}]


def test_purge_removes_only_old_finished_jobs():
    store = MemoryJobStore()
    keep, old = store.enqueue("keep", {}), store.enqueue("old", {})
    store.finish(old, DONE)
    old.finished_at = old.finished_at - timedelta(days=40)
    assert purge(store, registry()) == 1
    assert store.jobs == [keep]
