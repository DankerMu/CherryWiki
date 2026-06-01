from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

from cherry_worker_protocol import (
    InternalApiClient as _SharedInternalApiClient,
    WorkerProtocolConfig,
)
from cherry_worker_protocol import (
    generate_worker_id as _generate_worker_id,
)
from cherry_worker_protocol import (
    poll_jobs as _poll_jobs,
)
from cherry_worker_protocol import (
    run_once as _run_once,
)
from cherry_worker_protocol import (
    start_heartbeat_thread as _start_heartbeat_thread,
)
from cherry_worker_protocol.job_lifecycle import (
    _normalize_api_base_url,
    _parse_pending_job,
)

from .errors import IngestionJobError, build_error_json
from .handlers import IngestionJobHandler

INGESTION_WORKER_PROTOCOL = WorkerProtocolConfig(
    job_type="ingestion",
    worker_type="ingestion",
    worker_id_prefix="ingestion-worker",
    failure_log_message="ingestion job failed",
    worker_error_type=IngestionJobError,
    build_error_json=build_error_json,
)


class InternalApiClient(_SharedInternalApiClient):
    def fetch_pending_job(
        self, *, job_type: str = INGESTION_WORKER_PROTOCOL.job_type
    ) -> dict[str, Any] | None:
        return super().fetch_pending_job(job_type=job_type)

    def heartbeat(
        self,
        worker_id: str,
        active_jobs: list[str],
        *,
        worker_type: str = INGESTION_WORKER_PROTOCOL.worker_type,
    ) -> dict[str, Any]:
        return super().heartbeat(
            worker_id,
            active_jobs,
            worker_type=worker_type,
        )


def generate_worker_id() -> str:
    return _generate_worker_id(INGESTION_WORKER_PROTOCOL)


def run_once(
    *,
    api_client: InternalApiClient,
    handler: IngestionJobHandler,
    worker_id: str,
    active_jobs: Any | None = None,
) -> bool:
    return _run_once(
        config=INGESTION_WORKER_PROTOCOL,
        api_client=api_client,
        handler=handler,
        worker_id=worker_id,
        active_jobs=active_jobs,
    )


def poll_jobs(
    *,
    api_client: InternalApiClient,
    handler: IngestionJobHandler,
    worker_id: str,
    stop_event: threading.Event,
    poll_interval: float = 5,
    active_jobs: Any | None = None,
) -> None:
    _poll_jobs(
        config=INGESTION_WORKER_PROTOCOL,
        api_client=api_client,
        handler=handler,
        worker_id=worker_id,
        stop_event=stop_event,
        poll_interval=poll_interval,
        active_jobs=active_jobs,
    )


def start_heartbeat_thread(
    *,
    api_client: InternalApiClient,
    worker_id: str,
    active_jobs_getter: Callable[[], list[str]],
    stop_event: threading.Event,
    interval_seconds: float = 30,
) -> threading.Thread:
    return _start_heartbeat_thread(
        config=INGESTION_WORKER_PROTOCOL,
        api_client=api_client,
        worker_id=worker_id,
        active_jobs_getter=active_jobs_getter,
        stop_event=stop_event,
        interval_seconds=interval_seconds,
    )


__all__ = [
    "INGESTION_WORKER_PROTOCOL",
    "InternalApiClient",
    "generate_worker_id",
    "poll_jobs",
    "run_once",
    "start_heartbeat_thread",
    "_normalize_api_base_url",
    "_parse_pending_job",
]
