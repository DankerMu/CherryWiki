from __future__ import annotations

import sys
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


class FakeResponse:
    def __init__(
        self,
        payload: object,
        status_code: int = 200,
        text: str = "",
        reason: str = "",
    ) -> None:
        self.payload = payload
        self.status_code = status_code
        self.text = text
        self.reason = reason

    def json(self) -> object:
        return self.payload


@pytest.fixture
def cherrywiki_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHERRY_API_INTERNAL_URL", "http://cherry-api.internal")
    monkeypatch.setenv("CHERRY_AGENT_TOKEN", "agent-token")
