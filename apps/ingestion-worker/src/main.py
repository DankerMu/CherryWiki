from __future__ import annotations

import logging
import os
import signal
import threading
from types import FrameType

from .handlers import IngestionJobHandler
from .health import start_health_server
from .job_client import InternalApiClient, generate_worker_id, poll_jobs, start_heartbeat_thread
from .storage_client import MinioStorageClient


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    logger = logging.getLogger(__name__)

    worker_id = generate_worker_id()
    stop_event = threading.Event()
    active_jobs = _ActiveJobTracker()

    api_client = InternalApiClient.from_env()
    storage_client = MinioStorageClient.from_env()
    handler = IngestionJobHandler(storage_client=storage_client, timeout_seconds=_parse_int_env("INGESTION_TIMEOUT_SECONDS", 300))
    health_server = start_health_server(_parse_int_env("WORKER_HEALTH_PORT", 9091))

    def active_job_ids() -> list[str]:
        return active_jobs.snapshot()

    heartbeat_thread = start_heartbeat_thread(
        api_client=api_client,
        worker_id=worker_id,
        active_jobs_getter=active_job_ids,
        stop_event=stop_event,
        interval_seconds=_parse_float_env("WORKER_HEARTBEAT_INTERVAL_SECONDS", 30),
    )
    _register_shutdown_handlers(stop_event)

    logger.info("ingestion-worker started", extra={"worker_id": worker_id})
    try:
        poll_jobs(
            api_client=api_client,
            handler=handler,
            worker_id=worker_id,
            stop_event=stop_event,
            poll_interval=_parse_float_env("WORKER_POLL_INTERVAL_SECONDS", 5),
            active_jobs=active_jobs,
        )
    finally:
        stop_event.set()
        heartbeat_thread.join(timeout=5)
        health_server.shutdown()
        health_server.server_close()
        logger.info("ingestion-worker stopped", extra={"worker_id": worker_id})


def _register_shutdown_handlers(stop_event: threading.Event) -> None:
    def request_shutdown(_signum: int, _frame: FrameType | None) -> None:
        stop_event.set()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)


def _parse_int_env(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return int(value)


def _parse_float_env(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return float(value)


class _ActiveJobTracker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._job_ids: set[str] = set()

    def add(self, job_id: str) -> None:
        with self._lock:
            self._job_ids.add(job_id)

    def discard(self, job_id: str) -> None:
        with self._lock:
            self._job_ids.discard(job_id)

    def snapshot(self) -> list[str]:
        with self._lock:
            return sorted(self._job_ids)
