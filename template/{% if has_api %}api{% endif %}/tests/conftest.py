"""Database fixtures for the integration tests.

They run when TEST_DATABASE_URL points at a throwaway Postgres where every file of db/migrations/ is applied (CI does
this in the API job); otherwise they are skipped. Each test starts from empty job, settings and ledger tables. The
URL signs in as a superuser that may switch to the app role (`app_role`), as the tenancy tests do.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

from app.wiring import SCHEMA

TABLES = ("job", "settings", "settings_audit", "model_call_log", "tenant_note", "tenant")


@pytest.fixture(scope="session")
def database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set (integration test)")
    return url


@pytest.fixture(scope="session")
def session_pool(database_url: str) -> Iterator:
    from psycopg_pool import ConnectionPool

    pool = ConnectionPool(database_url, min_size=1, max_size=6, open=True, name="tests")
    yield pool
    pool.close()


@pytest.fixture
def pool(session_pool) -> Iterator:
    with session_pool.connection() as conn:
        present = [
            t
            for t in TABLES
            if conn.execute("SELECT to_regclass(%s) IS NOT NULL AS ok", (f"{SCHEMA}.{t}",)).fetchone()[0]
        ]
        names = ", ".join(f"{SCHEMA}.{t}" for t in present)
        conn.execute(f"TRUNCATE {names} RESTART IDENTITY CASCADE")
    yield session_pool


@pytest.fixture
def app_role() -> str:
    return f"{SCHEMA}_app"
