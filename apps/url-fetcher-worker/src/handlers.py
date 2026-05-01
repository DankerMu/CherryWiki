from __future__ import annotations

import datetime as dt
import os
import re
from typing import Any, Callable

from .fetcher import UrlFetcher
from .storage_client import MinioStorageClient, StorageObjectRef

ProgressReporter = Callable[[int, str], None]


class UrlFetchJobHandler:
    def __init__(
        self,
        *,
        storage_client: MinioStorageClient,
        fetcher: UrlFetcher | None = None,
        now: Callable[[], dt.datetime] | None = None,
    ) -> None:
        self.storage_client = storage_client
        self.fetcher = fetcher or UrlFetcher()
        self.now = now or (lambda: dt.datetime.now(dt.UTC))

    def handle(self, job: dict[str, Any], progress: ProgressReporter) -> dict[str, Any]:
        payload = _payload(job)
        source_document_id = payload.get("source_document_id")
        url = payload.get("url")
        tenant_id = _tenant_id(job)
        space_id = job.get("space_id")
        if (
            not isinstance(source_document_id, str)
            or not isinstance(url, str)
            or not isinstance(space_id, str)
        ):
            raise ValueError(
                "Job payload must include source_document_id and url, and job must include space_id"
            )

        progress(10, "fetching_url")
        snapshot = self.fetcher.fetch(url)
        progress(80, "uploading_snapshot")
        key = build_snapshot_key(
            tenant_id=tenant_id,
            space_id=space_id,
            sha256=snapshot.sha256,
            hostname=snapshot.hostname,
            archived_at=self.now(),
        )
        ref = StorageObjectRef(self.storage_client.archive_bucket, key)
        self.storage_client.upload(ref, snapshot.content, snapshot.content_type)
        progress(100, "done")
        return {
            "status": "success",
            "source_document_id": source_document_id,
            "sha256": snapshot.sha256,
            "snapshot_uri": ref.uri,
            "content_type": snapshot.content_type,
            "size_bytes": snapshot.size_bytes,
            "hostname": snapshot.hostname,
            "final_url": snapshot.final_url,
            "resolved_ip": snapshot.resolved_ip,
            "redirect_chain": snapshot.redirect_chain,
        }


def build_snapshot_key(
    *,
    tenant_id: str,
    space_id: str,
    sha256: str,
    hostname: str,
    archived_at: dt.datetime,
) -> str:
    if archived_at.tzinfo is None:
        archived_at = archived_at.replace(tzinfo=dt.UTC)
    archived_at = archived_at.astimezone(dt.UTC)
    return (
        f"archive/{_sanitize_path_segment(tenant_id)}/{_sanitize_path_segment(space_id)}/"
        f"{archived_at:%Y/%m/%d}/{sha256.lower()}_{_sanitize_filename(hostname)}.snapshot"
    )


def _payload(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload_json") or job.get("payload") or {}
    return payload if isinstance(payload, dict) else {}


def _tenant_id(job: dict[str, Any]) -> str:
    value = job.get("tenant_id") or os.environ.get("DEFAULT_TENANT_ID") or "default"
    return str(value)


def _sanitize_path_segment(value: str) -> str:
    sanitized = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._")
    return sanitized[:120] or "unknown"


def _sanitize_filename(value: str) -> str:
    sanitized = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._")
    return sanitized[:160] or "snapshot"
