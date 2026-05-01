from __future__ import annotations

import logging
import os
import platform
import threading
import uuid
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import requests

from .errors import UrlFetchJobError, build_error_json
from .handlers import UrlFetchJobHandler

logger = logging.getLogger(__name__)


class InternalApiClient:
    def __init__(
        self,
        base_url: str,
        *,
        api_key: str | None = None,
        session: requests.Session | None = None,
        timeout_seconds: int = 10,
    ) -> None:
        self.base_url = _normalize_api_base_url(base_url)
        self.api_key = api_key
        self.session = session or requests.Session()
        self.timeout_seconds = timeout_seconds

    @classmethod
    def from_env(cls) -> "InternalApiClient":
        base_url = (
            os.environ.get("CHERRY_API_URL")
            or os.environ.get("API_BASE_URL")
            or "http://cherry-api:8080/api"
        )
        return cls(base_url, api_key=os.environ.get("WORKER_API_KEY"))

    def fetch_pending_job(
        self, *, job_type: str = "url_fetch"
    ) -> dict[str, Any] | None:
        response = self.session.get(
            f"{self.base_url}/internal/jobs/pending",
            params={"type": job_type, "limit": 1},
            headers=self._headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        return _parse_pending_job(_unwrap_response(response.json()))

    def report_progress(
        self, job_id: str, worker_id: str, percent: int, stage: str
    ) -> None:
        response = self.session.patch(
            f"{self.base_url}/internal/jobs/{job_id}/progress",
            json={"worker_id": worker_id, "percent": percent, "stage": stage},
            headers=self._headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()

    def complete_job(
        self, job_id: str, worker_id: str, result_json: dict[str, Any]
    ) -> None:
        response = self.session.patch(
            f"{self.base_url}/internal/jobs/{job_id}/complete",
            json={"worker_id": worker_id, "result_json": result_json},
            headers=self._headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()

    def fail_job(
        self,
        job_id: str,
        worker_id: str,
        error_json: dict[str, Any],
        *,
        retryable: bool,
    ) -> None:
        response = self.session.patch(
            f"{self.base_url}/internal/jobs/{job_id}/fail",
            json={
                "worker_id": worker_id,
                "error_json": error_json,
                "retryable": retryable,
            },
            headers=self._headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()

    def heartbeat(self, worker_id: str, active_jobs: list[str]) -> dict[str, Any]:
        response = self.session.post(
            f"{self.base_url}/internal/workers/heartbeat",
            json={
                "worker_id": worker_id,
                "active_jobs": active_jobs,
                "system_info": {
                    "worker_type": "url_fetch",
                    "hostname": platform.node(),
                    "python_version": platform.python_version(),
                    "active_job_count": len(active_jobs),
                },
            },
            headers=self._headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = _unwrap_response(response.json())
        return payload if isinstance(payload, dict) else {}

    def _headers(self) -> dict[str, str]:
        headers = {"accept": "application/json"}
        if self.api_key:
            headers["x-worker-key"] = self.api_key
        return headers


def generate_worker_id() -> str:
    return os.environ.get("WORKER_ID") or f"url-fetcher-worker-{uuid.uuid4()}"


def run_once(
    *,
    api_client: InternalApiClient,
    handler: UrlFetchJobHandler,
    worker_id: str,
    active_jobs: Any | None = None,
) -> bool:
    job = api_client.fetch_pending_job(job_type="url_fetch")
    if job is None:
        return False

    job_id = _job_id(job)
    if active_jobs is not None:
        active_jobs.add(job_id)

    def progress(percent: int, stage: str) -> None:
        api_client.report_progress(job_id, worker_id, percent, stage)

    try:
        result = handler.handle(job, progress)
    except Exception as exc:
        retryable = exc.retryable if isinstance(exc, UrlFetchJobError) else True
        logger.exception("url_fetch job failed", extra={"job_id": job_id})
        api_client.fail_job(
            job_id, worker_id, build_error_json(exc), retryable=retryable
        )
    else:
        api_client.complete_job(job_id, worker_id, result)
    finally:
        if active_jobs is not None:
            active_jobs.discard(job_id)

    return True


def poll_jobs(
    *,
    api_client: InternalApiClient,
    handler: UrlFetchJobHandler,
    worker_id: str,
    stop_event: threading.Event,
    poll_interval: float = 5,
    active_jobs: Any | None = None,
) -> None:
    while not stop_event.is_set():
        try:
            handled = run_once(
                api_client=api_client,
                handler=handler,
                worker_id=worker_id,
                active_jobs=active_jobs,
            )
        except (requests.RequestException, OSError) as exc:
            logger.warning("job polling failed: %s", exc)
            handled = False
        except Exception:
            logger.exception("unexpected polling error")
            handled = False

        if not handled:
            stop_event.wait(poll_interval)


def start_heartbeat_thread(
    *,
    api_client: InternalApiClient,
    worker_id: str,
    active_jobs_getter: Callable[[], list[str]],
    stop_event: threading.Event,
    interval_seconds: float = 30,
) -> threading.Thread:
    def loop() -> None:
        while not stop_event.is_set():
            try:
                api_client.heartbeat(worker_id, active_jobs_getter())
            except Exception as exc:
                logger.warning("worker heartbeat failed: %s", exc)
            stop_event.wait(interval_seconds)

    thread = threading.Thread(target=loop, name="worker-heartbeat", daemon=True)
    thread.start()
    return thread


def _normalize_api_base_url(base_url: str) -> str:
    trimmed = base_url.rstrip("/")
    parsed = urlsplit(trimmed)
    if parsed.path in {"", "/"}:
        parsed = parsed._replace(path="/api")
        return urlunsplit(parsed).rstrip("/")
    return trimmed


def _unwrap_response(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload and "meta" in payload:
        return payload["data"]
    return payload


def _parse_pending_job(payload: Any) -> dict[str, Any] | None:
    if isinstance(payload, list):
        first = payload[0] if payload else None
        return first if isinstance(first, dict) else None
    if isinstance(payload, dict):
        job = payload.get("job")
        if isinstance(job, dict):
            return job
        jobs = payload.get("jobs")
        if isinstance(jobs, list):
            first = jobs[0] if jobs else None
            return first if isinstance(first, dict) else None
        if "id" in payload or "job_id" in payload:
            return payload
    return None


def _job_id(job: dict[str, Any]) -> str:
    raw_job_id = job.get("job_id") or job.get("id")
    if raw_job_id is None:
        raise ValueError("Pending job is missing job_id")
    return str(raw_job_id)
