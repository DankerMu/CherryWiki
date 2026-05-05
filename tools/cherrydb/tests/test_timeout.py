from __future__ import annotations

from click.testing import CliRunner

from cherrydb.cli import main


def test_query_timeout_reports_timeout_and_sets_statement_timeout(cherrydb_env, fake_db) -> None:
    connection = fake_db(fail_on_query=RuntimeError("canceling statement due to statement timeout"))

    result = CliRunner().invoke(main, ["query", "SELECT id FROM orders"])

    assert result.exit_code == 1
    assert "query timeout (5s exceeded)" in result.stderr
    assert connection.cursor_obj.executed[0][0] == "SET statement_timeout = '5s'"
