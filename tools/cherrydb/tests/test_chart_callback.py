"""Tests for _send_chart_callback in cherrydb chart command."""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

from click.testing import CliRunner

from cherrydb.cli import main


def _chart_env(monkeypatch, **overrides):
    """Set up full env for chart callback."""
    defaults = {
        "CHERRY_DB_DSN": "postgresql://readonly@example/cherry",
        "CHERRY_DB_ALLOWED_TABLES": "daily_stats",
        "CHERRY_CHART_CALLBACK_URL": "http://api.internal:8080/api/internal/agent/chart-event",
        "CHERRY_AGENT_TOKEN": "test-token-123",
        "CHERRY_CONVERSATION_ID": "conv-abc",
    }
    defaults.update(overrides)
    for key, value in defaults.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)


class TestChartCallback:
    def test_sends_post_when_all_env_present(self, monkeypatch, fake_db):
        _chart_env(monkeypatch)
        fake_db(description=[("x",), ("y",)], rows=[("A", 1)])

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.return_value = MagicMock(status=202)
            result = CliRunner().invoke(main, ["chart", "bar", "SELECT x, y FROM daily_stats"])

        assert result.exit_code == 0
        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        assert req.get_header("Authorization") == "Bearer test-token-123"
        assert req.get_header("Content-type") == "application/json"
        body = json.loads(req.data)
        assert body["conversationId"] == "conv-abc"
        assert body["chart"]["type"] == "cherrywiki.chart"
        assert body["chart"]["chart_type"] == "bar"

    def test_skips_silently_when_callback_url_missing(self, monkeypatch, fake_db):
        _chart_env(monkeypatch, CHERRY_CHART_CALLBACK_URL=None)
        fake_db(description=[("x",), ("y",)], rows=[("A", 1)])

        with patch("urllib.request.urlopen") as mock_urlopen:
            result = CliRunner().invoke(main, ["chart", "bar", "SELECT x, y FROM daily_stats"])

        assert result.exit_code == 0
        mock_urlopen.assert_not_called()
        assert "WARN" not in result.output + result.stderr

    def test_warns_on_stderr_when_token_missing(self, monkeypatch, fake_db):
        _chart_env(monkeypatch, CHERRY_AGENT_TOKEN=None)
        fake_db(description=[("x",), ("y",)], rows=[("A", 1)])

        with patch("urllib.request.urlopen") as mock_urlopen:
            result = CliRunner().invoke(main, ["chart", "bar", "SELECT x, y FROM daily_stats"])

        assert result.exit_code == 0
        mock_urlopen.assert_not_called()
        assert "CHERRY_AGENT_TOKEN" in result.stderr or "missing" in result.stderr.lower()

    def test_warns_on_stderr_when_conversation_id_missing(self, monkeypatch, fake_db):
        _chart_env(monkeypatch, CHERRY_CONVERSATION_ID=None)
        fake_db(description=[("x",), ("y",)], rows=[("A", 1)])

        with patch("urllib.request.urlopen") as mock_urlopen:
            result = CliRunner().invoke(main, ["chart", "bar", "SELECT x, y FROM daily_stats"])

        assert result.exit_code == 0
        mock_urlopen.assert_not_called()
        assert "CHERRY_CONVERSATION_ID" in result.stderr or "missing" in result.stderr.lower()

    def test_http_failure_does_not_affect_exit_code(self, monkeypatch, fake_db):
        _chart_env(monkeypatch)
        fake_db(description=[("x",), ("y",)], rows=[("A", 1)])

        import urllib.error

        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("connection refused")):
            result = CliRunner().invoke(main, ["chart", "bar", "SELECT x, y FROM daily_stats"])

        assert result.exit_code == 0
        assert "callback failed" in result.stderr.lower() or "warn" in result.stderr.lower()

    def test_timeout_3s_passed_to_urlopen(self, monkeypatch, fake_db):
        _chart_env(monkeypatch)
        fake_db(description=[("x",), ("y",)], rows=[("A", 1)])

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.return_value = MagicMock(status=202)
            CliRunner().invoke(main, ["chart", "bar", "SELECT x, y FROM daily_stats"])

        _, kwargs = mock_urlopen.call_args
        assert kwargs.get("timeout") == 3
