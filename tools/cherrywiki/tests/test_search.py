from __future__ import annotations

from click.testing import CliRunner

from cherrywiki.cli import main
from conftest import FakeResponse


def test_search_formats_results_and_sends_auth_header(monkeypatch, cherrywiki_env) -> None:
    calls: list[dict[str, object]] = []

    def fake_get(url: str, **kwargs: object) -> FakeResponse:
        calls.append({"url": url, **kwargs})
        return FakeResponse(
            {
                "results": [
                    {
                        "page_id": "page-1",
                        "page_title": "SSO Overview",
                        "section_title": "Token Refresh",
                        "score": 0.9123,
                        "content": "Refresh tokens are rotated after use.",
                    }
                ]
            }
        )

    monkeypatch.setattr("cherrywiki.cli.requests.get", fake_get)

    result = CliRunner().invoke(
        main,
        ["search", "token refresh", "--space", "space_rd", "--top", "5"],
    )

    assert result.exit_code == 0
    assert "SSO Overview" in result.output
    assert "score=0.91" in result.output
    assert "Refresh tokens are rotated after use." in result.output
    assert calls[0]["url"] == "http://cherry-api.internal/api/internal/search"
    assert calls[0]["headers"] == {"Authorization": "Bearer agent-token"}
    assert calls[0]["params"] == {
        "query": "token refresh",
        "top_k": 5,
        "space_ids": "space_rd",
    }
