from __future__ import annotations

from click.testing import CliRunner

from cherrywiki.cli import main
from conftest import FakeResponse


def test_page_reads_page_content(monkeypatch, cherrywiki_env) -> None:
    calls: list[dict[str, object]] = []

    def fake_get(url: str, **kwargs: object) -> FakeResponse:
        calls.append({"url": url, **kwargs})
        return FakeResponse({"title": "Architecture", "content": "# Architecture\nFull page."})

    monkeypatch.setattr("cherrywiki.cli.requests.get", fake_get)

    result = CliRunner().invoke(main, ["page", "page-1"])

    assert result.exit_code == 0
    assert "# Architecture" in result.output
    assert calls[0]["url"] == "http://cherry-api.internal/api/internal/pages/page-1"
    assert calls[0]["headers"] == {"Authorization": "Bearer agent-token"}


def test_page_filters_section_from_response(monkeypatch, cherrywiki_env) -> None:
    def fake_get(url: str, **kwargs: object) -> FakeResponse:
        assert kwargs["params"] == {"section": "s2"}
        return FakeResponse(
            {
                "content": "Full page",
                "sections": [
                    {"id": "s1", "content": "Intro"},
                    {"id": "s2", "content": "Only this section"},
                ],
            }
        )

    monkeypatch.setattr("cherrywiki.cli.requests.get", fake_get)

    result = CliRunner().invoke(main, ["page", "page-1", "--section", "s2"])

    assert result.exit_code == 0
    assert result.output.strip() == "Only this section"


def test_page_auth_failure_exits_with_error(monkeypatch, cherrywiki_env) -> None:
    def fake_get(url: str, **kwargs: object) -> FakeResponse:
        return FakeResponse({}, status_code=401, text="unauthorized")

    monkeypatch.setattr("cherrywiki.cli.requests.get", fake_get)

    result = CliRunner().invoke(main, ["page", "page-1"])

    assert result.exit_code == 1
    assert "authentication failed" in result.stderr
