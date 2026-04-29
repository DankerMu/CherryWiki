from __future__ import annotations

import asyncio

import pytest

from src import job_client


def test_poll_jobs_sleeps_after_lock_contention(monkeypatch: pytest.MonkeyPatch) -> None:
    asyncio.run(_assert_poll_jobs_sleeps_after_lock_contention(monkeypatch))


def test_poll_jobs_reports_runner_failure_and_releases_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    asyncio.run(_assert_poll_jobs_reports_runner_failure_and_releases_lock(monkeypatch))


async def _assert_poll_jobs_sleeps_after_lock_contention(monkeypatch: pytest.MonkeyPatch) -> None:
    sleep_calls: list[float] = []
    stop_event = asyncio.Event()

    async def fetch_pending_job(_http_client: object) -> dict[str, str]:
        return {"id": "job-1"}

    async def acquire(_redis_client: object, _job_id: str, _worker_id: str) -> bool:
        return False

    async def sleep(poll_interval: float, event: asyncio.Event | None) -> None:
        sleep_calls.append(poll_interval)
        assert event is stop_event
        stop_event.set()

    monkeypatch.setattr(job_client, "_fetch_pending_job", fetch_pending_job)
    monkeypatch.setattr(job_client, "acquire_lock", acquire)
    monkeypatch.setattr(job_client, "_sleep", sleep)

    await job_client.poll_jobs(
        "http://cherry-api.test",
        poll_interval=0.25,
        redis_client=object(),
        worker_id="worker-1",
        stop_event=stop_event,
    )

    assert sleep_calls == [0.25]


async def _assert_poll_jobs_reports_runner_failure_and_releases_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    failed_jobs: list[tuple[str, str, str]] = []
    released_locks: list[tuple[str, str]] = []
    stop_event = asyncio.Event()

    async def fetch_pending_job(_http_client: object) -> dict[str, str]:
        return {"id": "job-1"}

    async def acquire(_redis_client: object, _job_id: str, _worker_id: str) -> bool:
        return True

    async def runner(_job: dict[str, str]) -> dict[str, str]:
        raise RuntimeError("boom")

    async def fail_job(_http_client: object, job_id: str, exc: Exception) -> None:
        failed_jobs.append((job_id, str(exc), type(exc).__name__))
        stop_event.set()

    async def complete_job(_http_client: object, _job_id: str, _result: dict[str, str]) -> None:
        raise AssertionError("runner failures must not complete jobs")

    async def release(_redis_client: object, job_id: str, worker_id: str) -> bool:
        released_locks.append((job_id, worker_id))
        return True

    monkeypatch.setattr(job_client, "_fetch_pending_job", fetch_pending_job)
    monkeypatch.setattr(job_client, "acquire_lock", acquire)
    monkeypatch.setattr(job_client, "run", runner)
    monkeypatch.setattr(job_client, "_fail_job", fail_job)
    monkeypatch.setattr(job_client, "_complete_job", complete_job)
    monkeypatch.setattr(job_client, "release_lock", release)

    await job_client.poll_jobs(
        "http://cherry-api.test",
        poll_interval=0.25,
        redis_client=object(),
        worker_id="worker-1",
        stop_event=stop_event,
    )

    assert failed_jobs == [("job-1", "boom", "RuntimeError")]
    assert released_locks == [("job-1", "worker-1")]
