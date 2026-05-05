from __future__ import annotations

from click.testing import CliRunner

from cherrydb.cli import main


def test_tables_command_lists_allowed_tables(monkeypatch) -> None:
    monkeypatch.setenv("CHERRY_DB_ALLOWED_TABLES", "orders, departments, daily_stats")

    result = CliRunner().invoke(main, ["tables"])

    assert result.exit_code == 0
    assert "orders" in result.output
    assert "departments" in result.output
    assert "daily_stats" in result.output
