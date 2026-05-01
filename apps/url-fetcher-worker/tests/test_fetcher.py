from __future__ import annotations

from typing import Any

import pytest
import requests

from src.errors import ConnectionTimeoutError, FetchError, RequestTimeoutError, ResponseTooLargeError, SsrfBlockedError
from src.fetcher import UrlFetcher
from src.ssrf import ResolvedAddress


def test_fetcher_pins_dns_to_resolved_ip_and_preserves_host_header() -> None:
    session = FakeSession([FakeResponse(200, b"hello", {"content-type": "text/html; charset=utf-8"})])
    resolver = FakeResolver({"attacker.example": ["93.184.216.34"]})
    fetcher = UrlFetcher(resolver=resolver, session=session)

    snapshot = fetcher.fetch("http://attacker.example/docs")

    assert snapshot.sha256 == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    assert session.requests[0]["url"] == "http://93.184.216.34/docs"
    assert session.requests[0]["headers"]["Host"] == "attacker.example"
    assert "Authorization" not in session.requests[0]["headers"]
    assert session.requests[0]["kwargs"]["allow_redirects"] is False
    assert resolver.calls == ["attacker.example"]


def test_redirect_to_private_ip_is_blocked_after_revalidation() -> None:
    session = FakeSession([FakeResponse(302, b"", {"location": "http://private.example/admin"})])
    resolver = FakeResolver({"public.example": ["93.184.216.34"], "private.example": ["192.168.1.10"]})
    fetcher = UrlFetcher(resolver=resolver, session=session)

    with pytest.raises(SsrfBlockedError) as exc:
        fetcher.fetch("http://public.example/start")

    assert exc.value.metadata["block_reason"] == "redirect_to_private_ip"
    assert exc.value.metadata["original_block_reason"] == "private_ip_rfc1918"
    assert exc.value.metadata["resolved_ip"] == "192.168.1.10"
    assert exc.value.metadata["redirect_chain"][0]["to_url"] == "http://private.example/admin"
    assert resolver.calls == ["public.example", "private.example"]


def test_response_too_large_is_aborted() -> None:
    session = FakeSession([FakeResponse(200, [b"12345", b"67890", b"!"], {"content-type": "text/plain"})])
    fetcher = UrlFetcher(resolver=FakeResolver({"example.com": ["93.184.216.34"]}), session=session, max_response_bytes=10)

    with pytest.raises(ResponseTooLargeError) as exc:
        fetcher.fetch("http://example.com/large")

    assert exc.value.error_type == "response_too_large"
    assert exc.value.metadata["size_bytes"] == 11


def test_http_error_maps_to_fetch_error() -> None:
    session = FakeSession([FakeResponse(404, b"missing", {"content-type": "text/html"}, reason="Not Found")])
    fetcher = UrlFetcher(resolver=FakeResolver({"example.com": ["93.184.216.34"]}), session=session)

    with pytest.raises(FetchError) as exc:
        fetcher.fetch("http://example.com/missing")

    assert exc.value.error_type == "fetch_error"
    assert str(exc.value) == "HTTP 404 Not Found"
    assert exc.value.retryable is False


def test_connection_timeout_maps_to_connection_timeout() -> None:
    session = FakeSession([], error=requests.exceptions.ConnectTimeout("connect"))
    fetcher = UrlFetcher(resolver=FakeResolver({"example.com": ["93.184.216.34"]}), session=session)

    with pytest.raises(ConnectionTimeoutError) as exc:
        fetcher.fetch("http://example.com/slow")

    assert exc.value.error_type == "connection_timeout"


def test_read_timeout_maps_to_request_timeout() -> None:
    session = FakeSession([], error=requests.exceptions.ReadTimeout("read"))
    fetcher = UrlFetcher(resolver=FakeResolver({"example.com": ["93.184.216.34"]}), session=session)

    with pytest.raises(RequestTimeoutError) as exc:
        fetcher.fetch("http://example.com/slow")

    assert exc.value.error_type == "request_timeout"


class FakeResolver:
    def __init__(self, records: dict[str, list[str]]) -> None:
        self.records = records
        self.calls: list[str] = []

    def resolve(self, hostname: str, *, target_url: str = "") -> list[ResolvedAddress]:
        self.calls.append(hostname)
        from src.ssrf import IpValidator

        validated = IpValidator().validate_all(self.records[hostname], target_url=target_url)
        return [ResolvedAddress(ip=item.ip, original_ip=item.original_ip) for item in validated]


class FakeSession:
    def __init__(self, responses: list["FakeResponse"], error: BaseException | None = None) -> None:
        self.responses = responses
        self.error = error
        self.requests: list[dict[str, Any]] = []
        self.cookies = FakeCookies()

    def get(self, url: str, headers: dict[str, str], **kwargs: Any) -> "FakeResponse":
        self.requests.append({"url": url, "headers": headers, "kwargs": kwargs})
        if self.error is not None:
            raise self.error
        return self.responses.pop(0)


class FakeCookies:
    def clear(self) -> None:
        return


class FakeResponse:
    def __init__(self, status_code: int, body: bytes | list[bytes], headers: dict[str, str], reason: str | None = None) -> None:
        self.status_code = status_code
        self.body = body
        self.headers = headers
        self.reason = reason if reason is not None else ("OK" if status_code < 400 else "Error")
        self.closed = False

    def iter_content(self, chunk_size: int) -> list[bytes]:
        if isinstance(self.body, list):
            return self.body
        return [self.body]

    def close(self) -> None:
        self.closed = True
