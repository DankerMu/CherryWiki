from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Any

import httpx
from redis.asyncio import Redis

from .lock import acquire_lock, release_lock
from .runner import run

logger = logging.getLogger(__name__)


async def poll_jobs(
    api_base_url: str,
    poll_interval: float = 5,
    *,
    redis_client: Redis | None = None,
    redis_url: str | None = None,
    worker_id: str | None = None,
    stop_event: asyncio.Event | None = None,
    api_key: str | None = None,
) -> None:
    own_redis_client = redis_client is None
    redis = redis_client or Redis.from_url(
        redis_url or os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
        decode_responses=True,
    )
    current_worker_id = worker_id or f"graphify-worker-{uuid.uuid4()}"

    try:
        headers: dict[str, str] = {}
        if api_key:
            headers["x-worker-key"] = api_key
        async with httpx.AsyncClient(
            base_url=api_base_url.rstrip("/"),
            timeout=10,
            trust_env=False,
            headers=headers,
        ) as http_client:
            while stop_event is None or not stop_event.is_set():
                try:
                    job = await _fetch_pending_job(http_client)
                    if job is None:
                        await _sleep(poll_interval, stop_event)
                        continue

                    job_id = _job_id(job)
                    if job_id is None:
                        logger.warning("pending job missing id: %s", job)
                        await _sleep(poll_interval, stop_event)
                        continue

                    # Redis coordinates duplicate local workers; the API progress
                    # claim is the server-side ownership source of truth.
                    if not await acquire_lock(redis, job_id, current_worker_id):
                        await _sleep(poll_interval, stop_event)
                        continue

                    claim_failed = False
                    try:
                        if not await _claim_job(http_client, job_id, current_worker_id):
                            claim_failed = True
                        else:
                            try:
                                result = await run(job)
                            except Exception as exc:
                                logger.exception(
                                    "graphify job failed", extra={"job_id": job_id}
                                )
                                await _fail_job(
                                    http_client, job_id, current_worker_id, exc
                                )
                            else:
                                await _complete_job(
                                    http_client, job_id, current_worker_id, result
                                )
                    finally:
                        await release_lock(redis, job_id, current_worker_id)
                    if claim_failed:
                        await _sleep(poll_interval, stop_event)
                except (httpx.HTTPError, OSError) as exc:
                    logger.warning("job polling failed: %s", exc)
                    await _sleep(poll_interval, stop_event)
                except Exception:
                    logger.exception("unexpected job polling error")
                    await _sleep(poll_interval, stop_event)
    finally:
        if own_redis_client:
            await redis.aclose()


async def _fetch_pending_job(http_client: httpx.AsyncClient) -> dict[str, Any] | None:
    response = await http_client.get(
        "/internal/jobs/pending", params={"type": "graphify"}
    )
    response.raise_for_status()
    payload = response.json()
    return _parse_pending_job(payload)


async def _claim_job(
    http_client: httpx.AsyncClient, job_id: str, worker_id: str
) -> bool:
    try:
        await _report_progress(http_client, job_id, worker_id, 0, "claimed")
    except (httpx.HTTPError, OSError) as exc:
        logger.info(
            "failed to claim graphify job",
            extra={"job_id": job_id, "worker_id": worker_id, "error": str(exc)},
        )
        return False

    return True


async def _report_progress(
    http_client: httpx.AsyncClient,
    job_id: str,
    worker_id: str,
    percent: int,
    stage: str,
) -> None:
    response = await http_client.patch(
        f"/internal/jobs/{job_id}/progress",
        json={"worker_id": worker_id, "percent": percent, "stage": stage},
    )
    response.raise_for_status()


async def _complete_job(
    http_client: httpx.AsyncClient,
    job_id: str,
    worker_id: str,
    result: dict[str, Any],
) -> None:
    response = await http_client.patch(
        f"/internal/jobs/{job_id}/complete",
        json={"worker_id": worker_id, "result_json": result},
    )
    response.raise_for_status()


async def _fail_job(
    http_client: httpx.AsyncClient, job_id: str, worker_id: str, exc: Exception
) -> None:
    response = await http_client.patch(
        f"/internal/jobs/{job_id}/fail",
        json={
            "worker_id": worker_id,
            "error_json": _build_error_json(exc),
            "retryable": _is_retryable(exc),
        },
    )
    response.raise_for_status()


async def _sleep(poll_interval: float, stop_event: asyncio.Event | None) -> None:
    if stop_event is None:
        await asyncio.sleep(poll_interval)
        return

    try:
        await asyncio.wait_for(stop_event.wait(), timeout=poll_interval)
    except TimeoutError:
        return


def _parse_pending_job(payload: Any) -> dict[str, Any] | None:
    if isinstance(payload, list):
        first_job = payload[0] if payload else None
        return first_job if isinstance(first_job, dict) else None

    if not isinstance(payload, dict):
        return None

    data = payload.get("data")
    if isinstance(data, list):
        first_job = data[0] if data else None
        return first_job if isinstance(first_job, dict) else None

    job = payload.get("job")
    if isinstance(job, dict):
        return job

    jobs = payload.get("jobs")
    if isinstance(jobs, list):
        first_job = jobs[0] if jobs else None
        return first_job if isinstance(first_job, dict) else None

    if "id" in payload or "job_id" in payload:
        return payload

    return None


def _job_id(job: dict[str, Any]) -> str | None:
    raw_id = job.get("id") or job.get("job_id")
    if raw_id is None:
        return None

    return str(raw_id)


def _build_error_json(exc: Exception) -> dict[str, Any]:
    payload = _runtime_error_payload(exc)
    if payload is not None:
        return payload

    return {"error": str(exc), "error_type": type(exc).__name__}


def _is_retryable(exc: Exception) -> bool:
    payload = _runtime_error_payload(exc)
    return payload is not None and payload.get("retryable") is True


def _runtime_error_payload(exc: Exception) -> dict[str, Any] | None:
    if not isinstance(exc, RuntimeError):
        return None
    if len(exc.args) != 1 or not isinstance(exc.args[0], str):
        return None

    try:
        parsed = json.loads(exc.args[0])
    except json.JSONDecodeError:
        return None

    return parsed if isinstance(parsed, dict) else None
