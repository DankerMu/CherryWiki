from __future__ import annotations

import sys
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


class FakeCursor:
    def __init__(
        self,
        description: list[tuple[str, ...]] | None = None,
        rows: list[tuple[object, ...]] | None = None,
        fail_on_query: Exception | None = None,
    ) -> None:
        self.description = description or [("id",)]
        self.rows = rows or [(1,)]
        self.fail_on_query = fail_on_query
        self.executed: list[tuple[str, tuple[object, ...] | None]] = []
        self.closed = False

    def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
        self.executed.append((sql, params))
        if sql.startswith("SELECT * FROM") and self.fail_on_query is not None:
            raise self.fail_on_query

    def fetchall(self) -> list[tuple[object, ...]]:
        return self.rows

    def close(self) -> None:
        self.closed = True


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self.cursor_obj = cursor
        self.session_kwargs: dict[str, object] | None = None
        self.closed = False
        self.dsn: str | None = None

    def set_session(self, **kwargs: object) -> None:
        self.session_kwargs = kwargs

    def cursor(self) -> FakeCursor:
        return self.cursor_obj

    def close(self) -> None:
        self.closed = True


@pytest.fixture
def cherrydb_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHERRY_DB_DSN", "postgresql://readonly@example/cherry")
    monkeypatch.setenv("CHERRY_DB_ALLOWED_TABLES", "orders,employees,daily_stats")
    monkeypatch.delenv("CHERRY_DB_MASKED_COLUMNS", raising=False)


@pytest.fixture
def fake_db(monkeypatch: pytest.MonkeyPatch):
    from cherrydb import cli

    connections: list[FakeConnection] = []

    def install(
        description: list[tuple[str, ...]] | None = None,
        rows: list[tuple[object, ...]] | None = None,
        fail_on_query: Exception | None = None,
    ) -> FakeConnection:
        connection = FakeConnection(FakeCursor(description, rows, fail_on_query))

        def connect(dsn: str) -> FakeConnection:
            connection.dsn = dsn
            connections.append(connection)
            return connection

        monkeypatch.setattr(cli.psycopg2, "connect", connect)
        return connection

    install.connections = connections
    return install
