"""Skeleton API: health, readiness, deploy gate, admin settings. Invented values only."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.jobs import MemoryJobStore
from app.main import create_app
from app.settings_registry import MemorySettingsStore, SettingsRegistry


def client(role: str | None = None, **kw) -> TestClient:
    if role is not None:
        kw["current_role"] = lambda request: role
    return TestClient(create_app(**kw))


def test_health_reports_the_commit(monkeypatch):
    monkeypatch.setenv("GIT_SHA", "abc1234")
    r = client().get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "sha": "abc1234"}


def test_ready_lists_checks_and_fails_closed():
    assert client(ready_checks={"db": lambda: True}).get("/health/ready").json()["checks"] == ["db"]
    r = client(ready_checks={"db": lambda: False}).get("/health/ready")
    assert r.status_code == 503
    assert r.json()["detail"] == {"failed": ["db"]}


def test_deploy_gate_closes_while_jobs_are_busy():
    jobs = MemoryJobStore()
    c = client(jobs=jobs)
    assert c.get("/deploy-gate").json() == {"open": True, "busy_jobs": 0}
    jobs.enqueue("noop", {})
    assert c.get("/deploy-gate").json() == {"open": False, "busy_jobs": 1}


def test_admin_settings_need_sign_in_and_the_admin_role():
    assert client().get("/admin/settings").status_code == 401
    assert client(role="viewer").get("/admin/settings").status_code == 403
    rows = client(role="administrator").get("/admin/settings").json()
    assert {r["key"] for r in rows} >= {"jobs.max_attempts", "jobs.lease_seconds", "jobs.retention_days"}


def test_admin_change_is_bounded_and_audited():
    store = MemorySettingsStore()
    c = client(role="administrator", settings=SettingsRegistry(store))
    r = c.put("/admin/settings/jobs.max_attempts", json={"value": 5})
    assert r.status_code == 200
    assert r.json() == {"key": "jobs.max_attempts", "old": 3, "new": 5}
    assert store.audit[-1].changed_by == "administrator"
    assert c.put("/admin/settings/jobs.max_attempts", json={"value": 0}).status_code == 422
    assert c.put("/admin/settings/no.such.key", json={"value": 1}).status_code == 422
