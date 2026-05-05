from __future__ import annotations

import json

from click.testing import CliRunner

from cherrydb.cli import main


def test_chart_outputs_valid_echarts_options_for_supported_types(cherrydb_env, fake_db) -> None:
    for chart_type in ("bar", "line", "pie"):
        fake_db(description=[("department",), ("count",)], rows=[("Engineering", 2), ("Marketing", 1)])

        result = CliRunner().invoke(
            main,
            ["chart", chart_type, "SELECT department, count FROM daily_stats"],
        )

        assert result.exit_code == 0
        payload = json.loads(result.stdout)
        assert payload["type"] == "cherrywiki.chart"
        assert payload["chart_type"] == chart_type
        assert "echarts_option" in payload
        option = payload["echarts_option"]
        if chart_type == "pie":
            assert option["series"][0]["type"] == "pie"
            assert option["series"][0]["data"][0] == {"name": "Engineering", "value": 2}
        else:
            assert option["series"][0]["type"] == chart_type
            assert option["xAxis"]["data"] == ["Engineering", "Marketing"]
            assert option["series"][0]["data"] == [2, 1]
