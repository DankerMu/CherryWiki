from __future__ import annotations

import json

from click.testing import CliRunner

from cherrydb.cli import main


def test_query_writes_audit_log_json_to_stderr(cherrydb_env, fake_db) -> None:
    fake_db(description=[("id",)], rows=[(1,), (2,)])

    result = CliRunner().invoke(main, ["query", "SELECT id FROM orders"])

    assert result.exit_code == 0
    audit = json.loads(result.stderr.strip())
    assert audit["event"] == "database_query"
    assert audit["sql"] == "SELECT id FROM orders"
    assert audit["row_count"] == 2
    assert isinstance(audit["duration_ms"], int)
    assert audit["timestamp"].endswith("Z")
