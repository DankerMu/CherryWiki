from __future__ import annotations

import asyncio
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
) -> None:
    own_redis_client = redis_client is None
    redis = redis_client or Redis.from_url(
        redis_url or os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
        decode_responses=True,
    )
    current_worker_id = worker_id or f"graphify-worker-{uuid.uuid4()}"

    try:
        async with httpx.AsyncClient(
            base_url=api_base_url.rstrip("/"), timeout=10, trust_env=False
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

                    if not await acquire_lock(redis, job_id, current_worker_id):
                        await _sleep(poll_interval, stop_event)
                        continue

                    try:
                        try:
                            result = await run(job)
                        except Exception as exc:
                            logger.exception(
                                "graphify job failed", extra={"job_id": job_id}
                            )
                            await _fail_job(http_client, job_id, exc)
                        else:
                            await _complete_job(http_client, job_id, result)
                    finally:
                        await release_lock(redis, job_id, current_worker_id)
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


async def _complete_job(
    http_client: httpx.AsyncClient, job_id: str, result: dict[str, Any]
) -> None:
    response = await http_client.patch(f"/internal/jobs/{job_id}/complete", json=result)
    response.raise_for_status()


async def _fail_job(
    http_client: httpx.AsyncClient, job_id: str, exc: Exception
) -> None:
    response = await http_client.patch(
        f"/internal/jobs/{job_id}/failed",
        json={
            "status": "failed",
            "error": str(exc),
            "error_type": type(exc).__name__,
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
