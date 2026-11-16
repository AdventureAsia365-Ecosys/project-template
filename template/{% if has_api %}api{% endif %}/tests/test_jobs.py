"""Job table semantics on the memory store: claim, lease expiry, retries bounded by the settings registry."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.jobs import DONE, FAILED, QUEUED, RUNNING, MemoryJobStore, run_once
from app.settings_registry import MemorySettingsStore, SettingsRegistry

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
    second = run_once(store, settings, {"flaky": boom}, now=T0)
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
