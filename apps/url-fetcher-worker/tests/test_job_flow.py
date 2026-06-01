from __future__ import annotations

import datetime as dt
import threading
from typing import Any

import pytest

from cherry_worker_protocol import InternalApiClient as SharedInternalApiClient

from src.errors import ResponseTooLargeError
from src.fetcher import FetchSnapshot
from src.handlers import UrlFetchJobHandler
from src.job_client import (
    InternalApiClient,
    URL_FETCH_WORKER_PROTOCOL,
    generate_worker_id,
    run_once,
    start_heartbeat_thread,
)
from src.storage_client import StorageObjectRef


def test_url_fetch_protocol_config_preserves_worker_defaults() -> None:
    assert URL_FETCH_WORKER_PROTOCOL.job_type == "url_fetch"
    assert URL_FETCH_WORKER_PROTOCOL.worker_type == "url_fetch"
    assert URL_FETCH_WORKER_PROTOCOL.worker_id_prefix == "url-fetcher-worker"
    assert URL_FETCH_WORKER_PROTOCOL.failure_log_message == "url_fetch job failed"
    assert (
        URL_FETCH_WORKER_PROTOCOL.build_error_json(
            ResponseTooLargeError("too large", size_bytes=123)
        )["error_type"]
        == "response_too_large"
    )


def test_internal_api_client_preserves_url_fetch_defaults() -> None:
    assert issubclass(InternalApiClient, SharedInternalApiClient)
    session = FakeHttpSession(
        [
            FakeResponse({"data": [{"job_id": "job-1"}], "meta": {}}),
            FakeResponse({"data": {"accepted": True}, "meta": {}}),
        ]
    )
    client = InternalApiClient(
        "http://cherry-api:8080",
        api_key="worker-key",
        session=session,  # type: ignore[arg-type]
        timeout_seconds=3,
    )

    assert client.fetch_pending_job() == {"job_id": "job-1"}
    assert client.heartbeat("worker-1", ["job-1"]) == {"accepted": True}

    assert session.calls[0] == (
        "GET",
        "http://cherry-api:8080/api/internal/jobs/pending",
        {
            "headers": {"accept": "application/json", "x-worker-key": "worker-key"},
            "params": {"type": "url_fetch", "limit": 1},
            "timeout": 3,
        },
    )
    assert session.calls[1][2]["json"]["system_info"]["worker_type"] == "url_fetch"
    assert session.calls[1][2]["json"]["system_info"]["active_job_count"] == 1


def test_generate_worker_id_preserves_override_and_url_fetcher_prefix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("WORKER_ID", "explicit-worker")
    assert generate_worker_id() == "explicit-worker"

    monkeypatch.delenv("WORKER_ID", raising=False)
    assert generate_worker_id().startswith("url-fetcher-worker-")


def test_url_fetch_job_downloads_snapshot_uploads_and_completes() -> None:
    api = FakeApi([_job()])
    storage = FakeStorage()
    fetcher = FakeFetcher()
    handler = UrlFetchJobHandler(
        storage_client=storage,  # type: ignore[arg-type]
        fetcher=fetcher,  # type: ignore[arg-type]
        now=lambda: dt.datetime(2026, 5, 1, tzinfo=dt.UTC),
    )

    handled = run_once(api_client=api, handler=handler, worker_id="worker-1")

    assert handled is True
    assert api.completed[0][0] == "job-1"
    result = api.completed[0][1]
    assert result["source_document_id"] == "source-1"
    assert (
        result["snapshot_uri"]
        == "s3://cherrywiki-archives/archive/tenant-1/space-1/2026/05/01/abc123_example.com.snapshot"
    )
    assert result["content_type"] == "text/html"
    assert storage.uploads[result["snapshot_uri"]] == (b"<html>ok</html>", "text/html")
    assert any(stage == "fetching_url" for _, _, stage in api.progress)
    assert any(stage == "uploading_snapshot" for _, _, stage in api.progress)


def test_url_fetch_worker_error_uses_serializer_retryability_and_cleanup() -> None:
    api = FakeApi([_job()])
    handler = FakeFailingHandler(
        ResponseTooLargeError("response too large", size_bytes=201)
    )
    active_jobs: set[str] = set()

    handled = run_once(
        api_client=api,  # type: ignore[arg-type]
        handler=handler,  # type: ignore[arg-type]
        worker_id="worker-1",
        active_jobs=active_jobs,
    )

    assert handled is True
    assert api.completed == []
    assert api.failed[0][0] == "job-1"
    assert api.failed[0][1]["error_type"] == "response_too_large"
    assert api.failed[0][1]["size_bytes"] == 201
    assert api.failed[0][2] is False
    assert active_jobs == set()


def test_start_heartbeat_thread_preserves_url_fetch_worker_type() -> None:
    api = FakeHeartbeatApi()
    stop_event = threading.Event()

    thread = start_heartbeat_thread(
        api_client=api,  # type: ignore[arg-type]
        worker_id="worker-1",
        active_jobs_getter=lambda: ["job-1"],
        stop_event=stop_event,
        interval_seconds=0.01,
    )

    wait_for(lambda: bool(api.heartbeats))
    stop_event.set()
    thread.join(timeout=1)

    assert api.heartbeats[0] == ("worker-1", ["job-1"], "url_fetch")


class FakeFetcher:
    def fetch(self, url: str) -> FetchSnapshot:
        assert url == "https://example.com/page"
        return FetchSnapshot(
            content=b"<html>ok</html>",
            content_type="text/html",
            final_url=url,
            hostname="example.com",
            resolved_ip="93.184.216.34",
            size_bytes=15,
            sha256="abc123",
            redirect_chain=[],
        )


class FakeStorage:
    archive_bucket = "cherrywiki-archives"

    def __init__(self) -> None:
        self.uploads: dict[str, tuple[bytes, str]] = {}

    def upload(self, ref: StorageObjectRef, body: bytes, content_type: str) -> None:
        self.uploads[ref.uri] = (body, content_type)


class FakeFailingHandler:
    def __init__(self, exc: BaseException) -> None:
        self.exc = exc

    def handle(self, _job: dict[str, Any], progress: Any) -> dict[str, Any]:
        progress(10, "fetching_url")
        raise self.exc


class FakeApi:
    def __init__(self, jobs: list[dict[str, Any]]) -> None:
        self.jobs = jobs
        self.progress: list[tuple[str, int, str]] = []
        self.completed: list[tuple[str, dict[str, Any]]] = []
        self.failed: list[tuple[str, dict[str, Any], bool]] = []

    def fetch_pending_job(
        self, *, job_type: str = "url_fetch"
    ) -> dict[str, Any] | None:
        assert job_type == "url_fetch"
        return self.jobs.pop(0) if self.jobs else None

    def report_progress(
        self, job_id: str, _worker_id: str, percent: int, stage: str
    ) -> None:
        self.progress.append((job_id, percent, stage))

    def complete_job(
        self, job_id: str, _worker_id: str, result_json: dict[str, Any]
    ) -> None:
        self.completed.append((job_id, result_json))

    def fail_job(
        self,
        job_id: str,
        _worker_id: str,
        error_json: dict[str, Any],
        *,
        retryable: bool,
    ) -> None:
        self.failed.append((job_id, error_json, retryable))


class FakeHeartbeatApi:
    def __init__(self) -> None:
        self.heartbeats: list[tuple[str, list[str], str]] = []

    def heartbeat(
        self, worker_id: str, active_jobs: list[str], *, worker_type: str
    ) -> dict[str, Any]:
        self.heartbeats.append((worker_id, active_jobs, worker_type))
        return {"ok": True}


class FakeResponse:
    def __init__(self, payload: Any) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> Any:
        return self.payload


class FakeHttpSession:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append(("GET", url, kwargs))
        return self.responses.pop(0)

    def post(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append(("POST", url, kwargs))
        return self.responses.pop(0)


def wait_for(predicate: Any, *, timeout_seconds: float = 1) -> None:
    deadline = dt.datetime.now(tz=dt.UTC).timestamp() + timeout_seconds
    while dt.datetime.now(tz=dt.UTC).timestamp() < deadline:
        if predicate():
            return
    raise AssertionError("condition was not met before timeout")


def _job() -> dict[str, Any]:
    return {
        "job_id": "job-1",
        "tenant_id": "tenant-1",
        "space_id": "space-1",
        "created_by": "user-1",
        "payload_json": {
            "source_document_id": "source-1",
            "url": "https://example.com/page",
        },
    }
