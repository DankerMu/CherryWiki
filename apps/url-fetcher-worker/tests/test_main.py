from __future__ import annotations

import pytest

from src.errors import SsrfBlockedError
from src.main import _build_fetcher_from_env


def test_proxy_required_without_proxy_url_fails_startup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EGRESS_PROXY_REQUIRED", "true")
    monkeypatch.delenv("EGRESS_PROXY_URL", raising=False)

    with pytest.raises(RuntimeError) as exc:
        _build_fetcher_from_env()

    assert str(exc.value) == "EGRESS_PROXY_REQUIRED=true requires EGRESS_PROXY_URL"


def test_fetcher_env_applies_proxy_and_custom_ssrf_cidrs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EGRESS_PROXY_REQUIRED", "true")
    monkeypatch.setenv("EGRESS_PROXY_URL", "http://proxy.example:3128")
    monkeypatch.setenv("SSRF_BLOCKED_CIDRS", "203.0.113.0/24")

    fetcher = _build_fetcher_from_env()

    assert fetcher.proxy_required is True
    assert fetcher.proxies == {
        "http": "http://proxy.example:3128",
        "https": "http://proxy.example:3128",
    }
    with pytest.raises(SsrfBlockedError):
        fetcher.resolver.ip_validator.validate_ip("203.0.113.10")
    with pytest.raises(SsrfBlockedError):
        fetcher.resolver.ip_validator.validate_ip("10.1.2.3")


def test_invalid_ssrf_blocked_cidrs_fails_startup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SSRF_BLOCKED_CIDRS", "not-a-cidr")

    with pytest.raises(ValueError):
        _build_fetcher_from_env()
