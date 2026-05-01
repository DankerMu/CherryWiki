from __future__ import annotations

import hashlib
import ipaddress
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import SplitResult, urljoin, urlsplit, urlunsplit

import requests

from .errors import (
    ConnectionTimeoutError,
    FetchError,
    RequestTimeoutError,
    ResponseTooLargeError,
    SsrfBlockedError,
    TooManyRedirectsError,
)
from .pinned_adapter import PinnedIPAdapter
from .ssrf import DnsResolver, ResolvedAddress

DEFAULT_MAX_RESPONSE_BYTES = 50 * 1024 * 1024
DEFAULT_CONNECT_TIMEOUT_SECONDS = 10
DEFAULT_TOTAL_TIMEOUT_SECONDS = 30
DEFAULT_MAX_REDIRECTS = 5
REDIRECT_STATUSES = {301, 302, 307, 308}
USER_AGENT = "CherryWikiUrlFetcher/1.0"


@dataclass(frozen=True, slots=True)
class FetchSnapshot:
    content: bytes
    content_type: str
    final_url: str
    hostname: str
    resolved_ip: str
    size_bytes: int
    sha256: str
    redirect_chain: list[dict[str, Any]]


class UrlFetcher:
    def __init__(
        self,
        *,
        resolver: DnsResolver | None = None,
        session: Any | None = None,
        max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
        connect_timeout_seconds: int = DEFAULT_CONNECT_TIMEOUT_SECONDS,
        total_timeout_seconds: int = DEFAULT_TOTAL_TIMEOUT_SECONDS,
        max_redirects: int = DEFAULT_MAX_REDIRECTS,
    ) -> None:
        self.resolver = resolver or DnsResolver()
        self.session = session or requests.Session()
        self.max_response_bytes = max_response_bytes
        self.connect_timeout_seconds = connect_timeout_seconds
        self.total_timeout_seconds = total_timeout_seconds
        self.max_redirects = max_redirects

    def fetch(self, url: str) -> FetchSnapshot:
        current_url = self._normalize_url(url)
        started_at = time.monotonic()
        redirect_chain: list[dict[str, Any]] = []

        for hop in range(self.max_redirects + 1):
            self._raise_if_timed_out(started_at, current_url, redirect_chain)
            parsed = urlsplit(current_url)
            hostname = self._require_hostname(parsed, current_url)
            resolved = self._resolve(hostname, current_url, redirect_chain)
            pinned = resolved[0]

            response = self._request_once(
                current_url, parsed, pinned, started_at, redirect_chain
            )
            try:
                if response.status_code in REDIRECT_STATUSES:
                    if hop >= self.max_redirects:
                        raise TooManyRedirectsError(
                            f"Redirect depth exceeded {self.max_redirects}",
                            target_url=current_url,
                            resolved_ip=pinned.ip,
                            redirect_chain=redirect_chain,
                        )
                    location = response.headers.get("location") or response.headers.get(
                        "Location"
                    )
                    if not location:
                        raise FetchError(
                            f"HTTP {response.status_code} redirect without Location header",
                            retryable=False,
                            target_url=current_url,
                            resolved_ip=pinned.ip,
                            redirect_chain=redirect_chain,
                        )
                    next_url = self._normalize_url(urljoin(current_url, location))
                    redirect_chain.append(
                        {
                            "from_url": current_url,
                            "to_url": next_url,
                            "status": response.status_code,
                            "resolved_ip": pinned.ip,
                        }
                    )
                    current_url = next_url
                    continue

                if response.status_code >= 400:
                    reason = getattr(response, "reason", "") or ""
                    suffix = f" {reason}" if reason else ""
                    raise FetchError(
                        f"HTTP {response.status_code}{suffix}",
                        retryable=response.status_code >= 500,
                        target_url=current_url,
                        resolved_ip=pinned.ip,
                        redirect_chain=redirect_chain,
                    )

                content = self._read_response(
                    response, started_at, current_url, pinned.ip, redirect_chain
                )
                content_type = normalize_content_type(
                    response.headers.get("content-type")
                    or response.headers.get("Content-Type")
                )
                digest = hashlib.sha256(content).hexdigest()
                return FetchSnapshot(
                    content=content,
                    content_type=content_type,
                    final_url=current_url,
                    hostname=hostname,
                    resolved_ip=pinned.ip,
                    size_bytes=len(content),
                    sha256=digest,
                    redirect_chain=redirect_chain,
                )
            finally:
                close = getattr(response, "close", None)
                if callable(close):
                    close()

        raise TooManyRedirectsError(
            f"Redirect depth exceeded {self.max_redirects}",
            target_url=current_url,
            redirect_chain=redirect_chain,
        )

    def _request_once(
        self,
        current_url: str,
        parsed: SplitResult,
        pinned: ResolvedAddress,
        started_at: float,
        redirect_chain: list[dict[str, Any]],
    ) -> Any:
        remaining = max(
            1.0, self.total_timeout_seconds - (time.monotonic() - started_at)
        )
        pinned_url = self._pinned_url(parsed, pinned.ip)
        request_url = pinned_url
        adapter_prefix = (
            "https://"
            if parsed.scheme == "https" and isinstance(self.session, requests.Session)
            else None
        )
        previous_adapter = (
            self.session.adapters.get(adapter_prefix)
            if adapter_prefix is not None
            else None
        )
        headers = {
            "Host": self._host_header(parsed),
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
            "Connection": "close",
        }
        try:
            if adapter_prefix is not None:
                request_url = current_url
                self.session.mount(
                    adapter_prefix,
                    PinnedIPAdapter(
                        pinned_ip=pinned.ip, server_hostname=parsed.hostname or ""
                    ),
                )
            clear_cookies = getattr(
                getattr(self.session, "cookies", None), "clear", None
            )
            if callable(clear_cookies):
                clear_cookies()
            return self.session.get(
                request_url,
                headers=headers,
                allow_redirects=False,
                stream=True,
                timeout=(self.connect_timeout_seconds, remaining),
                cookies={},
            )
        except requests.exceptions.ConnectTimeout as exc:
            raise ConnectionTimeoutError(
                f"Connection timed out while fetching {current_url}",
                cause=exc,
                target_url=current_url,
                resolved_ip=pinned.ip,
                redirect_chain=redirect_chain,
            ) from exc
        except requests.exceptions.ReadTimeout as exc:
            raise RequestTimeoutError(
                f"Request timed out while fetching {current_url}",
                cause=exc,
                target_url=current_url,
                resolved_ip=pinned.ip,
                redirect_chain=redirect_chain,
            ) from exc
        except requests.exceptions.Timeout as exc:
            raise RequestTimeoutError(
                f"Request timed out while fetching {current_url}",
                cause=exc,
                target_url=current_url,
                resolved_ip=pinned.ip,
                redirect_chain=redirect_chain,
            ) from exc
        except requests.exceptions.RequestException as exc:
            raise FetchError(
                f"Failed to fetch {current_url}: {exc}",
                cause=exc,
                target_url=current_url,
                resolved_ip=pinned.ip,
                redirect_chain=redirect_chain,
            ) from exc
        finally:
            if adapter_prefix is not None and previous_adapter is not None:
                self.session.mount(adapter_prefix, previous_adapter)

    def _read_response(
        self,
        response: Any,
        started_at: float,
        current_url: str,
        resolved_ip: str,
        redirect_chain: list[dict[str, Any]],
    ) -> bytes:
        chunks: list[bytes] = []
        total = 0
        try:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                self._raise_if_timed_out(started_at, current_url, redirect_chain)
                if not chunk:
                    continue
                total += len(chunk)
                if total > self.max_response_bytes:
                    raise ResponseTooLargeError(
                        f"Response exceeded {self.max_response_bytes} bytes",
                        target_url=current_url,
                        resolved_ip=resolved_ip,
                        size_bytes=total,
                        max_response_bytes=self.max_response_bytes,
                        redirect_chain=redirect_chain,
                    )
                chunks.append(bytes(chunk))
        except requests.exceptions.ReadTimeout as exc:
            raise RequestTimeoutError(
                f"Request timed out while reading {current_url}",
                cause=exc,
                target_url=current_url,
                resolved_ip=resolved_ip,
                redirect_chain=redirect_chain,
            ) from exc
        except requests.exceptions.RequestException as exc:
            raise FetchError(
                f"Failed to read response from {current_url}: {exc}",
                cause=exc,
                target_url=current_url,
                resolved_ip=resolved_ip,
                redirect_chain=redirect_chain,
            ) from exc
        return b"".join(chunks)

    def _normalize_url(self, url: str) -> str:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"}:
            raise FetchError(
                "Only http and https URLs are supported",
                retryable=False,
                target_url=url,
            )
        if parsed.username is not None or parsed.password is not None:
            raise FetchError(
                "URLs with embedded credentials are not supported",
                retryable=False,
                target_url=url,
            )
        if parsed.hostname is None:
            raise FetchError(
                "URL is missing a hostname", retryable=False, target_url=url
            )
        return urlunsplit(parsed)

    def _require_hostname(self, parsed: SplitResult, current_url: str) -> str:
        if parsed.hostname is None:
            raise FetchError(
                "URL is missing a hostname", retryable=False, target_url=current_url
            )
        return parsed.hostname

    def _resolve(
        self, hostname: str, current_url: str, redirect_chain: list[dict[str, Any]]
    ) -> list[ResolvedAddress]:
        try:
            return self.resolver.resolve(hostname, target_url=current_url)
        except SsrfBlockedError as exc:
            exc.metadata["redirect_chain"] = redirect_chain
            if redirect_chain:
                exc.metadata["original_block_reason"] = exc.metadata.get("block_reason")
                exc.metadata["block_reason"] = "redirect_to_private_ip"
            raise

    def _pinned_url(self, parsed: SplitResult, ip: str) -> str:
        try:
            parsed_ip = ipaddress.ip_address(ip)
            host = f"[{ip}]" if isinstance(parsed_ip, ipaddress.IPv6Address) else ip
        except ValueError:
            host = ip
        if parsed.port is not None:
            host = f"{host}:{parsed.port}"
        return urlunsplit((parsed.scheme, host, parsed.path or "/", parsed.query, ""))

    def _host_header(self, parsed: SplitResult) -> str:
        hostname = parsed.hostname or ""
        try:
            parsed_host = ipaddress.ip_address(hostname)
            host = (
                f"[{hostname}]"
                if isinstance(parsed_host, ipaddress.IPv6Address)
                else hostname
            )
        except ValueError:
            host = hostname
        if parsed.port is not None:
            host = f"{host}:{parsed.port}"
        return host

    def _raise_if_timed_out(
        self, started_at: float, current_url: str, redirect_chain: list[dict[str, Any]]
    ) -> None:
        if time.monotonic() - started_at > self.total_timeout_seconds:
            raise RequestTimeoutError(
                f"Total request timeout exceeded {self.total_timeout_seconds}s",
                target_url=current_url,
                redirect_chain=redirect_chain,
            )


def normalize_content_type(value: str | None) -> str:
    if value is None or value.strip() == "":
        return "application/octet-stream"
    return value.split(";", 1)[0].strip().lower() or "application/octet-stream"
