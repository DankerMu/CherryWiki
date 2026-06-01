from __future__ import annotations

import threading
from typing import Any

import pytest
import requests

from cherry_worker_protocol import (
    InternalApiClient,
    WorkerProtocolConfig,
    generate_worker_id,
    poll_jobs,
    run_once,
    start_heartbeat_thread,
)
from cherry_worker_protocol.job_lifecycle import (
    _normalize_api_base_url,
    _parse_pending_job,
)


class WorkerError(Exception):
    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


def build_error_json(exc: BaseException) -> dict[str, Any]:
    return {"error_type": type(exc).__name__, "error_message": str(exc)}


CONFIG = WorkerProtocolConfig(
    job_type="example",
    worker_type="example",
    worker_id_prefix="example-worker",
    failure_log_message="example job failed",
    worker_error_type=WorkerError,
    build_error_json=build_error_json,
)


def test_api_base_url_defaults_to_api_prefix() -> None:
    assert (
        _normalize_api_base_url("http://cherry-api:8080")
        == "http://cherry-api:8080/api"
    )
    assert (
        _normalize_api_base_url("http://cherry-api:8080/")
        == "http://cherry-api:8080/api"
    )
    assert (
        _normalize_api_base_url("http://cherry-api:8080/api/")
        == "http://cherry-api:8080/api"
    )


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ([{"job_id": "job-1"}], {"job_id": "job-1"}),
        ({"job": {"id": "job-2"}}, {"id": "job-2"}),
        ({"jobs": [{"job_id": "job-3"}]}, {"job_id": "job-3"}),
        ({"id": "job-4"}, {"id": "job-4"}),
        ([], None),
        ({"jobs": []}, None),
        ({"data": "not-a-job"}, None),
    ],
)
def test_parse_pending_job_shapes(
    payload: Any, expected: dict[str, Any] | None
) -> None:
    assert _parse_pending_job(payload) == expected


def test_internal_api_client_uses_current_job_protocol_payloads() -> None:
    session = FakeSession(
        [
            FakeResponse({"data": [{"job_id": "job-1"}], "meta": {}}),
            FakeResponse({"ok": True}),
            FakeResponse({"ok": True}),
            FakeResponse({"ok": True}),
            FakeResponse({"data": {"accepted": True}, "meta": {}}),
        ]
    )
    client = InternalApiClient(
        "http://cherry-api:8080",
        api_key="worker-key",
        session=session,  # type: ignore[arg-type]
        timeout_seconds=7,
    )

    assert client.fetch_pending_job(job_type="example") == {"job_id": "job-1"}
    client.report_progress("job-1", "worker-1", 25, "parsing")
    client.complete_job("job-1", "worker-1", {"ok": True})
    client.fail_job(
        "job-2",
        "worker-1",
        {"error_type": "worker_error"},
        retryable=False,
    )
    assert client.heartbeat("worker-1", ["job-1", "job-2"], worker_type="example") == {
        "accepted": True
    }

    assert session.calls[0] == (
        "GET",
        "http://cherry-api:8080/api/internal/jobs/pending",
        {
            "headers": {"accept": "application/json", "x-worker-key": "worker-key"},
            "params": {"type": "example", "limit": 1},
            "timeout": 7,
        },
    )
    assert session.calls[1][2]["json"] == {
        "worker_id": "worker-1",
        "percent": 25,
        "stage": "parsing",
    }
    assert session.calls[2][2]["json"] == {
        "worker_id": "worker-1",
        "result_json": {"ok": True},
    }
    assert session.calls[3][2]["json"] == {
        "worker_id": "worker-1",
        "error_json": {"error_type": "worker_error"},
        "retryable": False,
    }
    assert session.calls[4][2]["json"]["system_info"]["worker_type"] == "example"
    assert session.calls[4][2]["json"]["system_info"]["active_job_count"] == 2


def test_generate_worker_id_uses_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WORKER_ID", "explicit-worker")
    assert generate_worker_id(CONFIG) == "explicit-worker"


def test_generate_worker_id_uses_configured_prefix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("WORKER_ID", raising=False)
    assert generate_worker_id(CONFIG).startswith("example-worker-")


def test_run_once_returns_false_when_no_job() -> None:
    api = FakeApi([])
    assert (
        run_once(
            config=CONFIG,
            api_client=api,  # type: ignore[arg-type]
            handler=FakeHandler({"ok": True}),
            worker_id="worker-1",
            active_jobs=set(),
        )
        is False
    )
    assert api.completed == []


def test_run_once_handles_job_progress_completion_and_active_cleanup() -> None:
    api = FakeApi([{"job_id": "job-1"}])
    active_jobs: set[str] = set()

    handled = run_once(
        config=CONFIG,
        api_client=api,  # type: ignore[arg-type]
        handler=FakeHandler({"parsed": True}),
        worker_id="worker-1",
        active_jobs=active_jobs,
    )

    assert handled is True
    assert api.fetched_job_types == ["example"]
    assert api.progress == [("job-1", "worker-1", 50, "handling")]
    assert api.completed == [("job-1", "worker-1", {"parsed": True})]
    assert api.failed == []
    assert active_jobs == set()


def test_run_once_reports_worker_errors_with_configured_retryability() -> None:
    api = FakeApi([{"id": "job-1"}])

    handled = run_once(
        config=CONFIG,
        api_client=api,  # type: ignore[arg-type]
        handler=FakeHandler(WorkerError("blocked", retryable=False)),
        worker_id="worker-1",
        active_jobs=set(),
    )

    assert handled is True
    assert api.completed == []
    assert api.failed == [
        (
            "job-1",
            "worker-1",
            {"error_type": "WorkerError", "error_message": "blocked"},
            False,
        )
    ]


def test_run_once_reports_unexpected_errors_as_retryable() -> None:
    api = FakeApi([{"id": "job-1"}])

    handled = run_once(
        config=CONFIG,
        api_client=api,  # type: ignore[arg-type]
        handler=FakeHandler(RuntimeError("temporary failure")),
        worker_id="worker-1",
    )

    assert handled is True
    assert api.failed == [
        (
            "job-1",
            "worker-1",
            {"error_type": "RuntimeError", "error_message": "temporary failure"},
            True,
        )
    ]


def test_run_once_cleans_up_active_job_when_terminal_report_fails() -> None:
    api = FakeApi([{"job_id": "job-1"}], complete_error=RuntimeError("api down"))
    active_jobs: set[str] = set()

    with pytest.raises(RuntimeError, match="api down"):
        run_once(
            config=CONFIG,
            api_client=api,  # type: ignore[arg-type]
            handler=FakeHandler({"ok": True}),
            worker_id="worker-1",
            active_jobs=active_jobs,
        )

    assert active_jobs == set()


def test_run_once_reports_progress_failure_and_cleans_up_active_job() -> None:
    api = FakeApi([{"job_id": "job-1"}], progress_error=RuntimeError("api down"))
    active_jobs: set[str] = set()

    handled = run_once(
        config=CONFIG,
        api_client=api,  # type: ignore[arg-type]
        handler=FakeHandler({"ok": True}),
        worker_id="worker-1",
        active_jobs=active_jobs,
    )

    assert handled is True
    assert api.completed == []
    assert api.failed == [
        (
            "job-1",
            "worker-1",
            {"error_type": "RuntimeError", "error_message": "api down"},
            True,
        )
    ]
    assert active_jobs == set()


def test_run_once_propagates_failed_terminal_report_errors() -> None:
    api = FakeApi([{"job_id": "job-1"}], fail_error=RuntimeError("api down"))
    active_jobs: set[str] = set()

    with pytest.raises(RuntimeError, match="api down"):
        run_once(
            config=CONFIG,
            api_client=api,  # type: ignore[arg-type]
            handler=FakeHandler(WorkerError("blocked", retryable=False)),
            worker_id="worker-1",
            active_jobs=active_jobs,
        )

    assert api.completed == []
    assert active_jobs == set()


def test_poll_jobs_waits_after_no_job_and_stops() -> None:
    api = FakeApi([])
    stop_event = StopAfterWaitEvent()

    poll_jobs(
        config=CONFIG,
        api_client=api,  # type: ignore[arg-type]
        handler=FakeHandler({"ok": True}),
        worker_id="worker-1",
        stop_event=stop_event,  # type: ignore[arg-type]
        poll_interval=0.25,
    )

    assert stop_event.waits == [0.25]


def test_poll_jobs_recovers_from_request_errors() -> None:
    api = FakeApi([], fetch_error=requests.RequestException("network"))
    stop_event = StopAfterWaitEvent()

    poll_jobs(
        config=CONFIG,
        api_client=api,  # type: ignore[arg-type]
        handler=FakeHandler({"ok": True}),
        worker_id="worker-1",
        stop_event=stop_event,  # type: ignore[arg-type]
        poll_interval=0.5,
    )

    assert stop_event.waits == [0.5]


def test_poll_jobs_recovers_from_terminal_report_errors() -> None:
    api = FakeApi(
        [{"job_id": "job-1"}], complete_error=requests.RequestException("api down")
    )
    stop_event = StopAfterWaitEvent()
    active_jobs: set[str] = set()

    poll_jobs(
        config=CONFIG,
        api_client=api,  # type: ignore[arg-type]
        handler=FakeHandler({"ok": True}),
        worker_id="worker-1",
        stop_event=stop_event,  # type: ignore[arg-type]
        poll_interval=0.5,
        active_jobs=active_jobs,
    )

    assert stop_event.waits == [0.5]
    assert active_jobs == set()


def test_poll_jobs_recovers_when_progress_failure_report_fails() -> None:
    api = FakeApi(
        [{"job_id": "job-1"}],
        progress_error=RuntimeError("progress api down"),
        fail_error=requests.RequestException("fail api down"),
    )
    stop_event = StopAfterWaitEvent()
    active_jobs: set[str] = set()

    poll_jobs(
        config=CONFIG,
        api_client=api,  # type: ignore[arg-type]
        handler=FakeHandler({"ok": True}),
        worker_id="worker-1",
        stop_event=stop_event,  # type: ignore[arg-type]
        poll_interval=0.5,
        active_jobs=active_jobs,
    )

    assert stop_event.waits == [0.5]
    assert api.completed == []
    assert active_jobs == set()


def test_start_heartbeat_thread_sends_configured_worker_type() -> None:
    api = FakeHeartbeatApi()
    stop_event = threading.Event()

    thread = start_heartbeat_thread(
        config=CONFIG,
        api_client=api,  # type: ignore[arg-type]
        worker_id="worker-1",
        active_jobs_getter=lambda: ["job-1"],
        stop_event=stop_event,
        interval_seconds=0.01,
    )

    wait_for(lambda: bool(api.heartbeats))
    stop_event.set()
    thread.join(timeout=1)

    assert api.heartbeats[0] == ("worker-1", ["job-1"], "example")


def test_start_heartbeat_thread_swallows_api_failures() -> None:
    api = FakeHeartbeatApi(failures_before_success=1)
    stop_event = threading.Event()

    thread = start_heartbeat_thread(
        config=CONFIG,
        api_client=api,  # type: ignore[arg-type]
        worker_id="worker-1",
        active_jobs_getter=lambda: ["job-1"],
        stop_event=stop_event,
        interval_seconds=0.01,
    )

    wait_for(lambda: bool(api.heartbeats))
    stop_event.set()
    thread.join(timeout=1)

    assert api.calls >= 2
    assert api.heartbeats == [("worker-1", ["job-1"], "example")]


class FakeHandler:
    def __init__(self, result_or_error: dict[str, Any] | BaseException) -> None:
        self.result_or_error = result_or_error

    def handle(self, job: dict[str, Any], progress: Any) -> dict[str, Any]:
        progress(50, "handling")
        if isinstance(self.result_or_error, BaseException):
            raise self.result_or_error
        return self.result_or_error


class FakeApi:
    def __init__(
        self,
        jobs: list[dict[str, Any]],
        *,
        fetch_error: BaseException | None = None,
        progress_error: BaseException | None = None,
        complete_error: BaseException | None = None,
        fail_error: BaseException | None = None,
    ) -> None:
        self.jobs = jobs
        self.fetch_error = fetch_error
        self.progress_error = progress_error
        self.complete_error = complete_error
        self.fail_error = fail_error
        self.fetched_job_types: list[str] = []
        self.progress: list[tuple[str, str, int, str]] = []
        self.completed: list[tuple[str, str, dict[str, Any]]] = []
        self.failed: list[tuple[str, str, dict[str, Any], bool]] = []

    def fetch_pending_job(self, *, job_type: str) -> dict[str, Any] | None:
        self.fetched_job_types.append(job_type)
        if self.fetch_error is not None:
            raise self.fetch_error
        return self.jobs.pop(0) if self.jobs else None

    def report_progress(
        self, job_id: str, worker_id: str, percent: int, stage: str
    ) -> None:
        if self.progress_error is not None:
            raise self.progress_error
        self.progress.append((job_id, worker_id, percent, stage))

    def complete_job(
        self, job_id: str, worker_id: str, result_json: dict[str, Any]
    ) -> None:
        if self.complete_error is not None:
            raise self.complete_error
        self.completed.append((job_id, worker_id, result_json))

    def fail_job(
        self,
        job_id: str,
        worker_id: str,
        error_json: dict[str, Any],
        *,
        retryable: bool,
    ) -> None:
        if self.fail_error is not None:
            raise self.fail_error
        self.failed.append((job_id, worker_id, error_json, retryable))


class FakeHeartbeatApi:
    def __init__(self, *, failures_before_success: int = 0) -> None:
        self.failures_before_success = failures_before_success
        self.calls = 0
        self.heartbeats: list[tuple[str, list[str], str]] = []

    def heartbeat(
        self, worker_id: str, active_jobs: list[str], *, worker_type: str
    ) -> dict[str, Any]:
        self.calls += 1
        if self.calls <= self.failures_before_success:
            raise RuntimeError("api down")
        self.heartbeats.append((worker_id, active_jobs, worker_type))
        return {"ok": True}


class FakeResponse:
    def __init__(self, payload: Any) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> Any:
        return self.payload


class FakeSession:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append(("GET", url, kwargs))
        return self.responses.pop(0)

    def patch(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append(("PATCH", url, kwargs))
        return self.responses.pop(0)

    def post(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append(("POST", url, kwargs))
        return self.responses.pop(0)


class StopAfterWaitEvent:
    def __init__(self) -> None:
        self.stopped = False
        self.waits: list[float] = []

    def is_set(self) -> bool:
        return self.stopped

    def wait(self, timeout: float) -> bool:
        self.waits.append(timeout)
        self.stopped = True
        return True


def wait_for(predicate: Any) -> None:
    for _ in range(100):
        if predicate():
            return
        threading.Event().wait(0.01)
    raise AssertionError("condition was not met")
