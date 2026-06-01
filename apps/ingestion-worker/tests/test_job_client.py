from __future__ import annotations

import threading
from typing import Any

import pytest

from src.job_client import _parse_pending_job, _normalize_api_base_url
from src.job_client import (
    INGESTION_WORKER_PROTOCOL,
    generate_worker_id,
    start_heartbeat_thread,
)


def test_parse_pending_job_handles_wrapped_list() -> None:
    assert _parse_pending_job([{"job_id": "job-1"}]) == {"job_id": "job-1"}


def test_api_base_url_defaults_to_api_prefix() -> None:
    assert (
        _normalize_api_base_url("http://cherry-api:8080")
        == "http://cherry-api:8080/api"
    )
    assert (
        _normalize_api_base_url("http://cherry-api:8080/api")
        == "http://cherry-api:8080/api"
    )


def test_ingestion_protocol_config_preserves_worker_identity() -> None:
    assert INGESTION_WORKER_PROTOCOL.job_type == "ingestion"
    assert INGESTION_WORKER_PROTOCOL.worker_type == "ingestion"
    assert INGESTION_WORKER_PROTOCOL.worker_id_prefix == "ingestion-worker"
    assert INGESTION_WORKER_PROTOCOL.failure_log_message == "ingestion job failed"


def test_generate_worker_id_uses_ingestion_prefix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("WORKER_ID", raising=False)
    assert generate_worker_id().startswith("ingestion-worker-")


def test_heartbeat_wrapper_reports_ingestion_worker_type() -> None:
    api = FakeHeartbeatApi()
    stop_event = threading.Event()

    thread = start_heartbeat_thread(
        api_client=api,  # type: ignore[arg-type]
        worker_id="worker-1",
        active_jobs_getter=lambda: ["job-1"],
        stop_event=stop_event,
        interval_seconds=0.01,
    )

    for _ in range(100):
        if api.heartbeats:
            break
        stop_event.wait(0.01)
    stop_event.set()
    thread.join(timeout=1)

    assert api.heartbeats == [("worker-1", ["job-1"], "ingestion")]


class FakeHeartbeatApi:
    def __init__(self) -> None:
        self.heartbeats: list[tuple[str, list[str], str]] = []

    def heartbeat(
        self, worker_id: str, active_jobs: list[str], *, worker_type: str
    ) -> dict[str, Any]:
        self.heartbeats.append((worker_id, active_jobs, worker_type))
        return {"ok": True}
