from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest

from src import job_client


def test_poll_jobs_claims_before_job_runs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    asyncio.run(_assert_poll_jobs_claims_before_job_runs(monkeypatch))


def test_poll_jobs_skips_job_when_claim_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    asyncio.run(_assert_poll_jobs_skips_job_when_claim_fails(monkeypatch))


def test_poll_jobs_sleeps_after_lock_contention(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    asyncio.run(_assert_poll_jobs_sleeps_after_lock_contention(monkeypatch))


def test_poll_jobs_reports_runner_failure_and_releases_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    asyncio.run(_assert_poll_jobs_reports_runner_failure_and_releases_lock(monkeypatch))


def test_claim_job_returns_false_on_conflict() -> None:
    asyncio.run(_assert_claim_job_returns_false_on_conflict())


def test_complete_job_sends_worker_result_dto() -> None:
    asyncio.run(_assert_complete_job_sends_worker_result_dto())


def test_fail_job_sends_worker_error_dto() -> None:
    asyncio.run(_assert_fail_job_sends_worker_error_dto())


def test_worker_id_consistency_across_status_requests() -> None:
    asyncio.run(_assert_worker_id_consistency_across_status_requests())


async def _assert_poll_jobs_claims_before_job_runs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[str, str]] = []
    stop_event = asyncio.Event()

    async def fetch_pending_jobs(_http_client: object) -> list[dict[str, str]]:
        return [{"id": "job-1"}]

    async def acquire(_redis_client: object, job_id: str, worker_id: str) -> bool:
        events.append(("acquire", f"{job_id}:{worker_id}"))
        return True

    async def claim_job(_http_client: object, job_id: str, worker_id: str) -> bool:
        events.append(("claim", f"{job_id}:{worker_id}"))
        return True

    async def runner(_job: dict[str, str]) -> dict[str, str]:
        events.append(("run", "job-1"))
        return {"status": "success"}

    async def complete_job(
        _http_client: object,
        job_id: str,
        worker_id: str,
        result: dict[str, str],
    ) -> None:
        events.append(("complete", f"{job_id}:{worker_id}:{result['status']}"))
        stop_event.set()

    async def fail_job(
        _http_client: object, _job_id: str, _worker_id: str, _exc: Exception
    ) -> None:
        raise AssertionError("successful jobs must not fail")

    async def release(_redis_client: object, job_id: str, worker_id: str) -> bool:
        events.append(("release", f"{job_id}:{worker_id}"))
        return True

    monkeypatch.setattr(job_client, "_fetch_pending_jobs", fetch_pending_jobs)
    monkeypatch.setattr(job_client, "acquire_lock", acquire)
    monkeypatch.setattr(job_client, "_claim_job", claim_job)
    monkeypatch.setattr(job_client, "run", runner)
    monkeypatch.setattr(job_client, "_complete_job", complete_job)
    monkeypatch.setattr(job_client, "_fail_job", fail_job)
    monkeypatch.setattr(job_client, "release_lock", release)

    await job_client.poll_jobs(
        "http://cherry-api.test",
        poll_interval=0.25,
        redis_client=object(),
        worker_id="worker-1",
        stop_event=stop_event,
    )

    assert events == [
        ("acquire", "job-1:worker-1"),
        ("claim", "job-1:worker-1"),
        ("run", "job-1"),
        ("complete", "job-1:worker-1:success"),
        ("release", "job-1:worker-1"),
    ]


async def _assert_poll_jobs_skips_job_when_claim_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    released_locks: list[tuple[str, str]] = []
    stop_event = asyncio.Event()

    async def fetch_pending_jobs(_http_client: object) -> list[dict[str, str]]:
        return [{"id": "job-1"}]

    async def acquire(_redis_client: object, _job_id: str, _worker_id: str) -> bool:
        return True

    async def claim_job(_http_client: object, job_id: str, worker_id: str) -> bool:
        assert (job_id, worker_id) == ("job-1", "worker-1")
        stop_event.set()
        return False

    async def runner(_job: dict[str, str]) -> dict[str, str]:
        raise AssertionError("unclaimed jobs must not run")

    async def complete_job(
        _http_client: object,
        _job_id: str,
        _worker_id: str,
        _result: dict[str, str],
    ) -> None:
        raise AssertionError("unclaimed jobs must not complete")

    async def fail_job(
        _http_client: object, _job_id: str, _worker_id: str, _exc: Exception
    ) -> None:
        raise AssertionError("unclaimed jobs must not fail")

    async def release(_redis_client: object, job_id: str, worker_id: str) -> bool:
        released_locks.append((job_id, worker_id))
        return True

    monkeypatch.setattr(job_client, "_fetch_pending_jobs", fetch_pending_jobs)
    monkeypatch.setattr(job_client, "acquire_lock", acquire)
    monkeypatch.setattr(job_client, "_claim_job", claim_job)
    monkeypatch.setattr(job_client, "run", runner)
    monkeypatch.setattr(job_client, "_complete_job", complete_job)
    monkeypatch.setattr(job_client, "_fail_job", fail_job)
    monkeypatch.setattr(job_client, "release_lock", release)

    await job_client.poll_jobs(
        "http://cherry-api.test",
        poll_interval=0.25,
        redis_client=object(),
        worker_id="worker-1",
        stop_event=stop_event,
    )

    assert released_locks == [("job-1", "worker-1")]


async def _assert_poll_jobs_sleeps_after_lock_contention(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sleep_calls: list[float] = []
    stop_event = asyncio.Event()

    async def fetch_pending_jobs(_http_client: object) -> list[dict[str, str]]:
        return [{"id": "job-1"}]

    async def acquire(_redis_client: object, _job_id: str, _worker_id: str) -> bool:
        return False

    async def sleep(poll_interval: float, event: asyncio.Event | None) -> None:
        sleep_calls.append(poll_interval)
        assert event is stop_event
        stop_event.set()

    monkeypatch.setattr(job_client, "_fetch_pending_jobs", fetch_pending_jobs)
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


async def _assert_poll_jobs_reports_runner_failure_and_releases_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failed_jobs: list[tuple[str, str, str, str]] = []
    released_locks: list[tuple[str, str]] = []
    stop_event = asyncio.Event()

    async def fetch_pending_jobs(_http_client: object) -> list[dict[str, str]]:
        return [{"id": "job-1"}]

    async def acquire(_redis_client: object, _job_id: str, _worker_id: str) -> bool:
        return True

    async def claim_job(_http_client: object, _job_id: str, _worker_id: str) -> bool:
        return True

    async def runner(_job: dict[str, str]) -> dict[str, str]:
        raise RuntimeError("boom")

    async def fail_job(
        _http_client: object, job_id: str, worker_id: str, exc: Exception
    ) -> None:
        failed_jobs.append((job_id, worker_id, str(exc), type(exc).__name__))
        stop_event.set()

    async def complete_job(
        _http_client: object,
        _job_id: str,
        _worker_id: str,
        _result: dict[str, str],
    ) -> None:
        raise AssertionError("runner failures must not complete jobs")

    async def release(_redis_client: object, job_id: str, worker_id: str) -> bool:
        released_locks.append((job_id, worker_id))
        return True

    monkeypatch.setattr(job_client, "_fetch_pending_jobs", fetch_pending_jobs)
    monkeypatch.setattr(job_client, "acquire_lock", acquire)
    monkeypatch.setattr(job_client, "_claim_job", claim_job)
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

    assert failed_jobs == [("job-1", "worker-1", "boom", "RuntimeError")]
    assert released_locks == [("job-1", "worker-1")]


async def _assert_claim_job_returns_false_on_conflict() -> None:
    requests: list[tuple[str, dict[str, Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(_captured_json_request(request))
        return httpx.Response(409, json={"message": "claimed elsewhere"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(
        base_url="http://cherry-api.test", transport=transport
    ) as client:
        claimed = await job_client._claim_job(client, "job-1", "worker-1")

    assert claimed is False
    assert requests == [
        (
            "/internal/jobs/job-1/progress",
            {"worker_id": "worker-1", "percent": 0, "stage": "claimed"},
        )
    ]


async def _assert_complete_job_sends_worker_result_dto() -> None:
    requests: list[tuple[str, dict[str, Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(_captured_json_request(request))
        return httpx.Response(200, json={"id": "job-1"})

    transport = httpx.MockTransport(handler)
    result = {"status": "success", "graph_json_uri": "s3://bucket/graph.json"}

    async with httpx.AsyncClient(
        base_url="http://cherry-api.test", transport=transport
    ) as client:
        await job_client._complete_job(client, "job-1", "worker-1", result)

    assert requests == [
        (
            "/internal/jobs/job-1/complete",
            {"worker_id": "worker-1", "result_json": result},
        )
    ]


async def _assert_fail_job_sends_worker_error_dto() -> None:
    requests: list[tuple[str, dict[str, Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(_captured_json_request(request))
        return httpx.Response(200, json={"will_retry": True})

    transport = httpx.MockTransport(handler)
    error_json = {"reason": "runner_disabled", "retryable": True}

    async with httpx.AsyncClient(
        base_url="http://cherry-api.test", transport=transport
    ) as client:
        await job_client._fail_job(
            client, "job-1", "worker-1", RuntimeError(json.dumps(error_json))
        )

    assert requests == [
        (
            "/internal/jobs/job-1/fail",
            {
                "worker_id": "worker-1",
                "error_json": error_json,
                "retryable": True,
            },
        )
    ]


async def _assert_worker_id_consistency_across_status_requests() -> None:
    requests: list[tuple[str, dict[str, Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(_captured_json_request(request))
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    worker_id = "worker-consistent"

    async with httpx.AsyncClient(
        base_url="http://cherry-api.test", transport=transport
    ) as client:
        assert await job_client._claim_job(client, "job-1", worker_id) is True
        await job_client._complete_job(client, "job-1", worker_id, {"ok": True})
        await job_client._fail_job(
            client,
            "job-2",
            worker_id,
            RuntimeError(json.dumps({"reason": "retry", "retryable": True})),
        )

    assert [payload["worker_id"] for _path, payload in requests] == [
        worker_id,
        worker_id,
        worker_id,
        worker_id,
    ]


def _captured_json_request(request: httpx.Request) -> tuple[str, dict[str, Any]]:
    return (request.url.path, json.loads(request.content))
