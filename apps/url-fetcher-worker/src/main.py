from __future__ import annotations

import logging
import os
import signal
import threading
from types import FrameType

from .fetcher import DEFAULT_MAX_RESPONSE_BYTES, UrlFetcher
from .handlers import UrlFetchJobHandler
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
    fetcher = UrlFetcher(
        max_response_bytes=_parse_int_env("URL_FETCH_MAX_RESPONSE_BYTES", DEFAULT_MAX_RESPONSE_BYTES),
        connect_timeout_seconds=_parse_int_env("URL_FETCH_CONNECT_TIMEOUT_SECONDS", 10),
        total_timeout_seconds=_parse_int_env("URL_FETCH_TIMEOUT_SECONDS", 30),
    )
    handler = UrlFetchJobHandler(storage_client=storage_client, fetcher=fetcher)
    health_server = start_health_server(_parse_int_env("WORKER_HEALTH_PORT", 9092))

    heartbeat_thread = start_heartbeat_thread(
        api_client=api_client,
        worker_id=worker_id,
        active_jobs_getter=active_jobs.snapshot,
        stop_event=stop_event,
        interval_seconds=_parse_float_env("WORKER_HEARTBEAT_INTERVAL_SECONDS", 30),
    )
    _register_shutdown_handlers(stop_event)

    logger.info("url-fetcher-worker started", extra={"worker_id": worker_id})
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
        logger.info("url-fetcher-worker stopped", extra={"worker_id": worker_id})


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
