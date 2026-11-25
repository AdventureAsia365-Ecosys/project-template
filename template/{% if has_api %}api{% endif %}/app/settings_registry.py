"""Settings registry: every threshold, limit, cap, retry limit or retention window is an admin-editable setting.

A setting has a key, a seeded default, bounds and a description an operator can read. Code reads the current value
with `registry.get(key)`; an administrator changes it through the admin API, and every change is audited (who, when,
old value, new value). Never a code literal or an environment variable alone (docs/templates/settings-entry.md).

Storage is behind `SettingsStore`: `MemorySettingsStore` for tests and local runs, `PostgresSettingsStore` (the
`settings` and `settings_audit` tables of migration 001) in deployed environments. A module that needs its own
settings declares a tuple of them next to its code (the tenancy and gateway modules do); `app/wiring.py` joins them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

from psycopg import sql


@dataclass(frozen=True)
class Setting:
    key: str
    default: int
    minimum: int
    maximum: int
    description: str


# The seeded settings. Add a row here (and its operator guide line) when code needs a new threshold.
SETTINGS: tuple[Setting, ...] = (
    Setting("jobs.max_attempts", 3, 1, 20, "Attempts of a job before it is marked failed."),
    Setting("jobs.lease_seconds", 300, 30, 3600, "How long a worker holds a claimed job before another may take it."),
    Setting("jobs.retention_days", 30, 1, 3650, "Days a finished job row is kept before clean-up."),
    Setting("jobs.retry_delay_seconds", 30, 0, 86400, "Wait before a failed job is tried again."),
)


@dataclass
class AuditEntry:
    key: str
    old: int
    new: int
    changed_by: str
    changed_at: datetime


class SettingsStore(Protocol):
    def load(self, key: str) -> int | None: ...

    def save(self, key: str, value: int, entry: AuditEntry) -> None: ...


@dataclass
class MemorySettingsStore:
    values: dict[str, int] = field(default_factory=dict)
    audit: list[AuditEntry] = field(default_factory=list)

    def load(self, key: str) -> int | None:
        return self.values.get(key)

    def save(self, key: str, value: int, entry: AuditEntry) -> None:
        self.values[key] = value
        self.audit.append(entry)


class PostgresSettingsStore:
    """The `settings` and `settings_audit` tables. A change and its audit row commit together or not at all."""

    def __init__(self, pool: Any, schema: str) -> None:
        self._pool = pool
        self._load = sql.SQL("SELECT value FROM {}.settings WHERE key = %s").format(sql.Identifier(schema))
        self._upsert = sql.SQL(
            "INSERT INTO {}.settings (key, value, updated_at) VALUES (%s, %s, %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at"
        ).format(sql.Identifier(schema))
        self._audit = sql.SQL(
            "INSERT INTO {}.settings_audit (key, old_value, new_value, changed_by, changed_at) "
            "VALUES (%s, %s, %s, %s, %s)"
        ).format(sql.Identifier(schema))

    def load(self, key: str) -> int | None:
        with self._pool.connection() as conn:
            row = conn.execute(self._load, (key,)).fetchone()
        return None if row is None else int(row[0])

    def save(self, key: str, value: int, entry: AuditEntry) -> None:
        with self._pool.connection() as conn, conn.transaction():
            conn.execute(self._upsert, (key, value, entry.changed_at))
            conn.execute(self._audit, (key, entry.old, entry.new, entry.changed_by, entry.changed_at))


class SettingError(ValueError):
    """Unknown key or a value outside the setting's bounds."""


class SettingsRegistry:
    def __init__(self, store: SettingsStore, settings: tuple[Setting, ...] = SETTINGS) -> None:
        self._store = store
        self._settings = {s.key: s for s in settings}
        if len(self._settings) != len(settings):
            raise SettingError("two settings share a key")

    def has(self, key: str) -> bool:
        return key in self._settings

    def definitions(self) -> list[Setting]:
        return list(self._settings.values())

    def _definition(self, key: str) -> Setting:
        if key not in self._settings:
            raise SettingError(f"unknown setting {key}")
        return self._settings[key]

    def get(self, key: str) -> int:
        definition = self._definition(key)
        stored = self._store.load(key)
        return definition.default if stored is None else stored

    def set(self, key: str, value: int, changed_by: str) -> AuditEntry:
        definition = self._definition(key)
        if not definition.minimum <= value <= definition.maximum:
            raise SettingError(f"{key} must be between {definition.minimum} and {definition.maximum}")
        entry = AuditEntry(key, self.get(key), value, changed_by, datetime.now(UTC))
        self._store.save(key, value, entry)
        return entry
