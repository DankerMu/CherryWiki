from __future__ import annotations

import datetime as dt
from typing import Any

from src.fetcher import FetchSnapshot
from src.handlers import UrlFetchJobHandler
from src.job_client import run_once
from src.storage_client import StorageObjectRef


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
    assert result["snapshot_uri"] == "s3://cherrywiki-archives/archive/tenant-1/space-1/2026/05/01/abc123_example.com.snapshot"
    assert result["content_type"] == "text/html"
    assert storage.uploads[result["snapshot_uri"]] == (b"<html>ok</html>", "text/html")
    assert any(stage == "fetching_url" for _, _, stage in api.progress)
    assert any(stage == "uploading_snapshot" for _, _, stage in api.progress)


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


class FakeApi:
    def __init__(self, jobs: list[dict[str, Any]]) -> None:
        self.jobs = jobs
        self.progress: list[tuple[str, int, str]] = []
        self.completed: list[tuple[str, dict[str, Any]]] = []
        self.failed: list[tuple[str, dict[str, Any], bool]] = []

    def fetch_pending_job(self, *, job_type: str = "url_fetch") -> dict[str, Any] | None:
        assert job_type == "url_fetch"
        return self.jobs.pop(0) if self.jobs else None

    def report_progress(self, job_id: str, _worker_id: str, percent: int, stage: str) -> None:
        self.progress.append((job_id, percent, stage))

    def complete_job(self, job_id: str, _worker_id: str, result_json: dict[str, Any]) -> None:
        self.completed.append((job_id, result_json))

    def fail_job(self, job_id: str, _worker_id: str, error_json: dict[str, Any], *, retryable: bool) -> None:
        self.failed.append((job_id, error_json, retryable))


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
