from __future__ import annotations

import json

from click.testing import CliRunner

from cherrydb.cli import main


def test_query_uses_readonly_session_and_1000_row_limit(cherrydb_env, fake_db) -> None:
    connection = fake_db(description=[("id",)], rows=[(1,)])

    result = CliRunner().invoke(main, ["query", "SELECT id FROM orders"])

    assert result.exit_code == 0
    assert connection.session_kwargs == {"readonly": True}
    executed_sql = [sql for sql, _ in connection.cursor_obj.executed]
    assert "SET statement_timeout = '5s'" in executed_sql
    assert "SET work_mem = '64MB'" in executed_sql
    assert "SELECT * FROM (SELECT id FROM orders) AS _q LIMIT 1000" in executed_sql


def test_query_masks_configured_columns(monkeypatch, cherrydb_env, fake_db) -> None:
    monkeypatch.setenv("CHERRY_DB_MASKED_COLUMNS", "employees.salary,employees.ssn")
    fake_db(description=[("name",), ("salary",), ("ssn",)], rows=[("Ada", 200000, "123-45")])

    result = CliRunner().invoke(
        main,
        ["query", "SELECT name, salary, ssn FROM employees", "--format", "json"],
    )

    assert result.exit_code == 0
    assert json.loads(result.stdout) == [{"name": "Ada", "salary": "***", "ssn": "***"}]


def test_query_rejects_multi_statement_sql(cherrydb_env, fake_db) -> None:
    fake_db()

    result = CliRunner().invoke(main, ["query", "SELECT id FROM orders; DROP TABLE orders"])

    assert result.exit_code == 1
    assert "multi-statement SQL rejected" in result.stderr
    assert fake_db.connections == []


def test_query_rejects_cte_write_sql(cherrydb_env, fake_db) -> None:
    fake_db()

    result = CliRunner().invoke(
        main,
        ["query", "WITH deleted AS (DELETE FROM orders RETURNING *) SELECT * FROM deleted"],
    )

    assert result.exit_code == 1
    assert "CTE write operations rejected" in result.stderr
    assert fake_db.connections == []
