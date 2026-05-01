from __future__ import annotations

import mimetypes
import re
import shutil
import signal
import tempfile
import threading
import time
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator

from .errors import IngestionJobError, ParseTimeoutError, build_error_json
from .output import build_parsed_artifacts, derive_artifact_key, sha256_file
from .parsers import ParserRegistry
from .storage_client import MinioStorageClient, StorageObjectRef, parse_storage_uri

ProgressReporter = Callable[[int, str], None]


@dataclass(frozen=True, slots=True)
class UploadedParse:
    parsed_uri: str
    preview_uri: str
    metadata: dict[str, Any]


class IngestionJobHandler:
    def __init__(
        self,
        *,
        storage_client: MinioStorageClient,
        parser_registry: ParserRegistry | None = None,
        timeout_seconds: int = 300,
    ) -> None:
        self.storage_client = storage_client
        self.parser_registry = parser_registry or ParserRegistry()
        self.timeout_seconds = timeout_seconds

    def handle(self, job: dict[str, Any], progress: ProgressReporter) -> dict[str, Any]:
        payload = _payload(job)
        source_document_id = payload.get("source_document_id")
        archive_uri = payload.get("archive_uri")
        mime_type = payload.get("mime_type")
        if not isinstance(source_document_id, str) or not isinstance(archive_uri, str) or not isinstance(mime_type, str):
            raise IngestionJobError("parse_error", "Job payload must include source_document_id, archive_uri, and mime_type", retryable=False)

        archive_ref = parse_storage_uri(archive_uri)
        tmpdir = Path(tempfile.mkdtemp(prefix=f"ingestion-{_job_id(job)}-"))
        local_path = tmpdir / _local_filename(payload, archive_ref.key)

        try:
            progress(10, "downloading")
            try:
                self.storage_client.download(archive_ref, local_path)
            except Exception as exc:
                raise IngestionJobError("download_error", f"Failed to download {archive_uri}: {exc}", cause=exc) from exc

            if self.parser_registry.is_zip(mime_type=mime_type, file_path=local_path, filename=local_path.name):
                progress(20, "parsing_zip")
                try:
                    return self._handle_zip(job, payload, archive_ref, local_path, tmpdir, progress)
                except IngestionJobError:
                    raise
                except Exception as exc:
                    raise IngestionJobError("parse_error", f"Failed to parse ZIP archive: {exc}", retryable=False, cause=exc) from exc

            progress(20, "parsing_started")
            uploaded = self._parse_upload_one(
                job=job,
                payload=payload,
                archive_ref=archive_ref,
                file_path=local_path,
                filename=local_path.name,
                mime_type=mime_type,
                progress=progress,
                parsed_suffix="parsed.md",
                preview_suffix="preview.txt",
            )
            progress(100, "done")
            return {
                "status": "success",
                "parsed_uri": uploaded.parsed_uri,
                "preview_uri": uploaded.preview_uri,
                "metadata": uploaded.metadata,
            }
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def _handle_zip(
        self,
        job: dict[str, Any],
        payload: dict[str, Any],
        archive_ref: StorageObjectRef,
        zip_path: Path,
        tmpdir: Path,
        progress: ProgressReporter,
    ) -> dict[str, Any]:
        documents: list[dict[str, Any]] = []
        extract_dir = tmpdir / "zip"
        extract_dir.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(zip_path) as archive:
            members = [member for member in archive.infolist() if not member.is_dir()]
            total = max(1, len(members))
            for index, member in enumerate(members, start=1):
                stage_percent = 20 + int((index - 1) / total * 60)
                progress(stage_percent, f"parsing_zip_member_{index}")
                try:
                    member_path = self._extract_member(archive, member, extract_dir, index)
                    member_mime = mimetypes.guess_type(member.filename)[0] or "application/octet-stream"
                    member_sha = sha256_file(member_path)
                    member_payload = {
                        **payload,
                        "sha256": member_sha,
                        "filename": member.filename,
                    }
                    uploaded = self._parse_upload_one(
                        job=job,
                        payload=member_payload,
                        archive_ref=archive_ref,
                        file_path=member_path,
                        filename=member.filename,
                        mime_type=member_mime,
                        progress=progress,
                        parsed_suffix=f"{_slug(member.filename, index)}.parsed.md",
                        preview_suffix=f"{_slug(member.filename, index)}.preview.txt",
                    )
                    documents.append(
                        {
                            "filename": member.filename,
                            "status": "parsed",
                            "parsed_uri": uploaded.parsed_uri,
                            "preview_uri": uploaded.preview_uri,
                            "metadata": uploaded.metadata,
                        }
                    )
                except Exception as exc:
                    documents.append(
                        {
                            "filename": member.filename,
                            "status": "parse_failed",
                            "error_json": build_error_json(_as_ingestion_error(exc)),
                        }
                    )

        successes = [item for item in documents if item["status"] == "parsed"]
        failures = [item for item in documents if item["status"] == "parse_failed"]
        if not successes:
            raise IngestionJobError("parse_error", "No ZIP members were parsed successfully", retryable=False)

        progress(100, "done")
        first = successes[0]
        return {
            "status": "partial_success" if failures else "success",
            "parsed_uri": first["parsed_uri"],
            "preview_uri": first["preview_uri"],
            "metadata": {
                "zip_total_files": len(documents),
                "zip_success_count": len(successes),
                "zip_failure_count": len(failures),
            },
            "documents": documents,
        }

    def _extract_member(self, archive: zipfile.ZipFile, member: zipfile.ZipInfo, extract_dir: Path, index: int) -> Path:
        if member.filename.startswith("/") or ".." in Path(member.filename).parts:
            raise IngestionJobError("parse_error", f"Unsafe ZIP member path: {member.filename}", retryable=False)
        target = extract_dir / f"{index}-{Path(member.filename).name}"
        with archive.open(member) as source, target.open("wb") as destination:
            shutil.copyfileobj(source, destination)
        return target

    def _parse_upload_one(
        self,
        *,
        job: dict[str, Any],
        payload: dict[str, Any],
        archive_ref: StorageObjectRef,
        file_path: Path,
        filename: str,
        mime_type: str,
        progress: ProgressReporter,
        parsed_suffix: str,
        preview_suffix: str,
    ) -> UploadedParse:
        started_at = time.monotonic()
        try:
            with timeout_after(self.timeout_seconds):
                parser = self.parser_registry.parser_for(mime_type=mime_type, file_path=file_path, filename=filename)
                parse_result = parser.parse(file_path)
        except ParseTimeoutError as exc:
            duration_ms = int((time.monotonic() - started_at) * 1000)
            raise IngestionJobError("timeout", f"Parsing exceeded {self.timeout_seconds}s timeout", retryable=False, cause=exc, duration_ms=duration_ms) from exc
        except IngestionJobError:
            raise
        except Exception as exc:
            raise IngestionJobError("parse_error", f"Failed to parse {filename}: {exc}", retryable=False, cause=exc) from exc

        duration_ms = int((time.monotonic() - started_at) * 1000)
        source_sha = str(payload.get("sha256") or sha256_file(file_path))
        source_type = str(payload.get("source_type") or parse_result.metadata.get("source_type") or mime_type)
        artifacts = build_parsed_artifacts(
            parse_result=parse_result,
            job=job,
            payload=payload,
            filename=filename,
            source_type=source_type,
            sha256=source_sha,
            duration_ms=duration_ms,
        )

        parsed_key = derive_artifact_key(archive_ref.key, source_sha, parsed_suffix)
        preview_key = derive_artifact_key(archive_ref.key, source_sha, preview_suffix)
        progress(90, "uploading_output")
        try:
            self.storage_client.upload(StorageObjectRef(archive_ref.bucket, parsed_key), artifacts.parsed_markdown.encode("utf-8"), "text/markdown; charset=utf-8")
            self.storage_client.upload(StorageObjectRef(archive_ref.bucket, preview_key), artifacts.preview_text.encode("utf-8"), "text/plain; charset=utf-8")
        except Exception as exc:
            raise IngestionJobError("upload_error", f"Failed to upload parsed output for {filename}: {exc}", cause=exc) from exc

        return UploadedParse(
            parsed_uri=f"s3://{archive_ref.bucket}/{parsed_key}",
            preview_uri=f"s3://{archive_ref.bucket}/{preview_key}",
            metadata=artifacts.metadata,
        )


@contextmanager
def timeout_after(seconds: int) -> Iterator[None]:
    if seconds <= 0 or not hasattr(signal, "SIGALRM") or threading.current_thread() is not threading.main_thread():
        yield
        return

    def handler(_signum: int, _frame: object) -> None:
        raise ParseTimeoutError()

    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_alarm = signal.alarm(0)
    signal.signal(signal.SIGALRM, handler)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_alarm:
            signal.alarm(previous_alarm)


def _payload(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload_json") or job.get("payload") or {}
    return payload if isinstance(payload, dict) else {}


def _job_id(job: dict[str, Any]) -> str:
    return str(job.get("job_id") or job.get("id") or "unknown")


def _local_filename(payload: dict[str, Any], archive_key: str) -> str:
    filename = payload.get("filename") or payload.get("original_filename") or Path(archive_key).name
    if isinstance(filename, str) and re.match(r"^[0-9a-fA-F]{64}_.+", filename):
        return filename[65:]
    return str(filename)


def _slug(value: str, index: int) -> str:
    stem = Path(value).stem or f"file-{index}"
    sanitized = re.sub(r"[^A-Za-z0-9_.-]+", "_", stem).strip("._")
    return sanitized[:80] or f"file-{index}"


def _as_ingestion_error(exc: BaseException) -> IngestionJobError:
    if isinstance(exc, IngestionJobError):
        return exc
    return IngestionJobError("parse_error", str(exc), retryable=False, cause=exc)
