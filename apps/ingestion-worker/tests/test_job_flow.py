from __future__ import annotations

import io
import time
import zipfile
from pathlib import Path
from typing import Any

from src.job_client import run_once
from src.handlers import IngestionJobHandler
from src.parsers.base_parser import BaseParser, ParseResult
from src.storage_client import StorageObjectRef


def test_worker_lifecycle_poll_download_parse_upload_complete() -> None:
    archive_uri = "s3://cherrywiki-archives/archive/tenant-1/space-1/2026/05/01/source.txt"
    api = FakeApi([_job(archive_uri, "text/plain")])
    storage = FakeStorage({archive_uri: b"Lifecycle body"})
    handler = IngestionJobHandler(storage_client=storage)  # type: ignore[arg-type]

    handled = run_once(api_client=api, handler=handler, worker_id="worker-1")

    assert handled is True
    assert api.completed[0][0] == "job-1"
    assert api.completed[0][1]["parsed_uri"].endswith(".parsed.md")
    assert api.completed[0][1]["preview_uri"].endswith(".preview.txt")
    assert any(stage == "downloading" for _, _, stage in api.progress)
    assert any(stage == "uploading_output" for _, _, stage in api.progress)
    assert len(storage.uploads) == 2


def test_parse_failure_reports_parse_failed_and_preserves_archive() -> None:
    archive_uri = "s3://cherrywiki-archives/archive/tenant-1/space-1/2026/05/01/bad.pdf"
    api = FakeApi([_job(archive_uri, "application/pdf")])
    storage = FakeStorage({archive_uri: b"not a pdf"})
    handler = IngestionJobHandler(storage_client=storage)  # type: ignore[arg-type]

    run_once(api_client=api, handler=handler, worker_id="worker-1")

    assert api.failed[0][0] == "job-1"
    assert api.failed[0][1]["error_type"] == "parse_error"
    assert storage.objects[archive_uri] == b"not a pdf"
    assert storage.uploads == {}


def test_timeout_reports_timeout_error() -> None:
    archive_uri = "s3://cherrywiki-archives/archive/tenant-1/space-1/2026/05/01/slow.txt"
    api = FakeApi([_job(archive_uri, "text/plain")])
    storage = FakeStorage({archive_uri: b"slow"})
    handler = IngestionJobHandler(
        storage_client=storage,  # type: ignore[arg-type]
        parser_registry=SlowRegistry(),  # type: ignore[arg-type]
        timeout_seconds=1,
    )

    run_once(api_client=api, handler=handler, worker_id="worker-1")

    assert api.failed[0][1]["error_type"] == "timeout"
    assert api.failed[0][2] is False


def test_zip_batch_allows_partial_failure() -> None:
    archive_uri = "s3://cherrywiki-archives/archive/tenant-1/space-1/2026/05/01/batch.zip"
    zip_bytes = io.BytesIO()
    with zipfile.ZipFile(zip_bytes, "w") as archive:
        archive.writestr("good.txt", "Good member")
        archive.writestr("bad.pdf", b"not a pdf")
    api = FakeApi([_job(archive_uri, "application/zip")])
    storage = FakeStorage({archive_uri: zip_bytes.getvalue()})
    handler = IngestionJobHandler(storage_client=storage)  # type: ignore[arg-type]

    run_once(api_client=api, handler=handler, worker_id="worker-1")

    result = api.completed[0][1]
    assert result["status"] == "partial_success"
    assert result["metadata"]["zip_success_count"] == 1
    assert result["metadata"]["zip_failure_count"] == 1
    statuses = {document["filename"]: document["status"] for document in result["documents"]}
    assert statuses == {"good.txt": "parsed", "bad.pdf": "parse_failed"}


class FakeStorage:
    def __init__(self, objects: dict[str, bytes]) -> None:
        self.objects = dict(objects)
        self.uploads: dict[str, tuple[bytes, str]] = {}

    def download(self, ref: StorageObjectRef, destination: Path) -> None:
        destination.write_bytes(self.objects[ref.uri])

    def upload(self, ref: StorageObjectRef, body: bytes, content_type: str) -> None:
        self.uploads[ref.uri] = (body, content_type)


class FakeApi:
    def __init__(self, jobs: list[dict[str, Any]]) -> None:
        self.jobs = jobs
        self.progress: list[tuple[str, int, str]] = []
        self.completed: list[tuple[str, dict[str, Any]]] = []
        self.failed: list[tuple[str, dict[str, Any], bool]] = []

    def fetch_pending_job(self, *, job_type: str = "ingestion") -> dict[str, Any] | None:
        assert job_type == "ingestion"
        return self.jobs.pop(0) if self.jobs else None

    def report_progress(self, job_id: str, _worker_id: str, percent: int, stage: str) -> None:
        self.progress.append((job_id, percent, stage))

    def complete_job(self, job_id: str, _worker_id: str, result_json: dict[str, Any]) -> None:
        self.completed.append((job_id, result_json))

    def fail_job(self, job_id: str, _worker_id: str, error_json: dict[str, Any], *, retryable: bool) -> None:
        self.failed.append((job_id, error_json, retryable))


class SlowParser(BaseParser):
    def parse(self, _file_path: Path) -> ParseResult:
        time.sleep(2)
        return ParseResult("too late")


class SlowRegistry:
    def is_zip(self, **_kwargs: Any) -> bool:
        return False

    def parser_for(self, **_kwargs: Any) -> BaseParser:
        return SlowParser()


def _job(archive_uri: str, mime_type: str) -> dict[str, Any]:
    return {
        "job_id": "job-1",
        "space_id": "space-1",
        "created_by": "user-1",
        "payload_json": {
            "source_document_id": "doc-1",
            "archive_uri": archive_uri,
            "mime_type": mime_type,
        },
    }
