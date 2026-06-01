from __future__ import annotations

import threading
from typing import Any

import pytest

from src.job_client import (
    INGESTION_WORKER_PROTOCOL,
    InternalApiClient,
    _normalize_api_base_url,
    _parse_pending_job,
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


def test_internal_api_client_fetch_pending_job_defaults_to_ingestion() -> None:
    session = FakeSession(get_payload=[{"job_id": "job-1"}])
    client = InternalApiClient(
        "http://cherry-api:8080",
        api_key="worker-key",
        session=session,  # type: ignore[arg-type]
        timeout_seconds=5,
    )

    assert client.fetch_pending_job() == {"job_id": "job-1"}

    assert session.get_calls == [
        {
            "url": "http://cherry-api:8080/api/internal/jobs/pending",
            "params": {"type": "ingestion", "limit": 1},
            "headers": {
                "accept": "application/json",
                "x-worker-key": "worker-key",
            },
            "timeout": 5,
        }
    ]


def test_internal_api_client_heartbeat_defaults_to_ingestion_worker_type() -> None:
    session = FakeSession(post_payload={"ok": True})
    client = InternalApiClient(
        "http://cherry-api:8080/api",
        session=session,  # type: ignore[arg-type]
    )

    assert client.heartbeat("worker-1", ["job-1"]) == {"ok": True}

    assert session.post_calls
    request = session.post_calls[0]
    assert request["url"] == "http://cherry-api:8080/api/internal/workers/heartbeat"
    assert request["json"]["worker_id"] == "worker-1"
    assert request["json"]["active_jobs"] == ["job-1"]
    assert request["json"]["system_info"]["worker_type"] == "ingestion"
    assert request["json"]["system_info"]["active_job_count"] == 1


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


class FakeResponse:
    def __init__(self, payload: Any) -> None:
        self.payload = payload

    def json(self) -> Any:
        return self.payload

    def raise_for_status(self) -> None:
        return None


class FakeSession:
    def __init__(
        self,
        *,
        get_payload: Any | None = None,
        post_payload: Any | None = None,
    ) -> None:
        self.get_payload = get_payload
        self.post_payload = post_payload
        self.get_calls: list[dict[str, Any]] = []
        self.post_calls: list[dict[str, Any]] = []

    def get(
        self,
        url: str,
        *,
        params: dict[str, Any],
        headers: dict[str, str],
        timeout: int,
    ) -> FakeResponse:
        self.get_calls.append(
            {
                "url": url,
                "params": params,
                "headers": headers,
                "timeout": timeout,
            }
        )
        return FakeResponse(self.get_payload)

    def post(
        self,
        url: str,
        *,
        json: dict[str, Any],
        headers: dict[str, str],
        timeout: int,
    ) -> FakeResponse:
        self.post_calls.append(
            {
                "url": url,
                "json": json,
                "headers": headers,
                "timeout": timeout,
            }
        )
        return FakeResponse(self.post_payload)


class FakeHeartbeatApi:
    def __init__(self) -> None:
        self.heartbeats: list[tuple[str, list[str], str]] = []

    def heartbeat(
        self, worker_id: str, active_jobs: list[str], *, worker_type: str
    ) -> dict[str, Any]:
        self.heartbeats.append((worker_id, active_jobs, worker_type))
        return {"ok": True}
