import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const localWorkerPython = path.join(rootDir, 'apps/url-fetcher-worker/.venv/bin/python');
const pythonBin =
  process.env.URL_FETCHER_PYTHON ?? (existsSync(localWorkerPython) ? localWorkerPython : 'python3');

describe('URL fetcher egress dependency-container smoke', () => {
  it('uses URL fetcher runtime imports for redirect blocking and proxy fail-closed behavior', () => {
    const script = String.raw`
import json
import os
from typing import Any

import requests

from src.errors import FetchError, SsrfBlockedError
from src.fetcher import UrlFetcher
from src.main import _build_fetcher_from_env
from src.ssrf import IpValidator, ResolvedAddress


class FakeResolver:
    def __init__(self, records: dict[str, list[str]]) -> None:
        self.records = records
        self.calls: list[str] = []

    def resolve(self, hostname: str, *, target_url: str = "") -> list[ResolvedAddress]:
        self.calls.append(hostname)
        validated = IpValidator().validate_all(
            self.records[hostname],
            target_url=target_url,
        )
        return [
            ResolvedAddress(ip=item.ip, original_ip=item.original_ip)
            for item in validated
        ]


class FakeSession:
    def __init__(
        self,
        responses: list["FakeResponse"] | None = None,
        error: BaseException | None = None,
    ) -> None:
        self.responses = responses or []
        self.error = error
        self.requests: list[dict[str, Any]] = []
        self.cookies = FakeCookies()

    def get(self, url: str, headers: dict[str, str], **kwargs: Any) -> "FakeResponse":
        self.requests.append({"url": url, "headers": headers, "kwargs": kwargs})
        if self.error is not None:
            raise self.error
        if not self.responses:
            raise AssertionError("unexpected direct fetch fallback")
        return self.responses.pop(0)


class FakeCookies:
    def clear(self) -> None:
        return


class FakeResponse:
    def __init__(self, status_code: int, body: bytes, headers: dict[str, str]) -> None:
        self.status_code = status_code
        self.body = body
        self.headers = headers
        self.reason = "OK"

    def iter_content(self, chunk_size: int) -> list[bytes]:
        return [self.body]

    def close(self) -> None:
        return


redirect_session = FakeSession(
    [FakeResponse(302, b"", {"location": "http://metadata.example/latest"})]
)
redirect_resolver = FakeResolver(
    {
        "public.example": ["93.184.216.34"],
        "metadata.example": ["169.254.169.254"],
    }
)
redirect_fetcher = UrlFetcher(resolver=redirect_resolver, session=redirect_session)

try:
    redirect_fetcher.fetch("http://public.example/start")
except SsrfBlockedError as exc:
    redirect_block = exc.metadata
else:
    raise AssertionError("metadata redirect was allowed")

if len(redirect_session.requests) != 1:
    raise AssertionError("redirect target was fetched before SSRF revalidation")

previous_required = os.environ.get("EGRESS_PROXY_REQUIRED")
previous_proxy = os.environ.get("EGRESS_PROXY_URL")
try:
    os.environ["EGRESS_PROXY_REQUIRED"] = "true"
    os.environ.pop("EGRESS_PROXY_URL", None)
    try:
        _build_fetcher_from_env()
    except RuntimeError as exc:
        missing_proxy_error = str(exc)
    else:
        raise AssertionError("proxy-required startup allowed a missing proxy")
finally:
    if previous_required is None:
        os.environ.pop("EGRESS_PROXY_REQUIRED", None)
    else:
        os.environ["EGRESS_PROXY_REQUIRED"] = previous_required
    if previous_proxy is None:
        os.environ.pop("EGRESS_PROXY_URL", None)
    else:
        os.environ["EGRESS_PROXY_URL"] = previous_proxy

proxy_session = FakeSession(error=requests.exceptions.ProxyError("proxy down"))
proxy_fetcher = UrlFetcher(
    resolver=FakeResolver({"example.com": ["93.184.216.34"]}),
    session=proxy_session,
    proxy_url="http://127.0.0.1:1",
    proxy_required=True,
)

try:
    proxy_fetcher.fetch("http://example.com/proxied")
except FetchError as exc:
    proxy_error = str(exc)
else:
    raise AssertionError("unreachable required proxy was allowed")

if len(proxy_session.requests) != 1:
    raise AssertionError("fetch retried without the required proxy")

print(
    json.dumps(
        {
            "missing_proxy_error": missing_proxy_error,
            "proxy_error": proxy_error,
            "proxy_request_count": len(proxy_session.requests),
            "proxy_request_proxies": proxy_session.requests[0]["kwargs"]["proxies"],
            "redirect_block": redirect_block,
            "redirect_request_count": len(redirect_session.requests),
            "resolver_calls": redirect_resolver.calls,
        },
        sort_keys=True,
    )
)
`;

    const result = spawnSync(pythonBin, ['-c', script], {
      cwd: rootDir,
      env: {
        ...process.env,
        PYTHONPATH: path.join(rootDir, 'apps/url-fetcher-worker'),
      },
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
      timeout: 10_000,
    });

    expect(result.error, result.error?.message ?? result.stderr ?? result.stdout).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      missing_proxy_error: 'EGRESS_PROXY_REQUIRED=true requires EGRESS_PROXY_URL',
      proxy_request_count: 1,
      proxy_request_proxies: {
        http: 'http://127.0.0.1:1',
        https: 'http://127.0.0.1:1',
      },
      redirect_block: {
        block_reason: 'redirect_to_private_ip',
        original_block_reason: 'link_local_metadata',
        resolved_ip: '169.254.169.254',
      },
      redirect_request_count: 1,
      resolver_calls: ['public.example', 'metadata.example'],
    });
  });
});
