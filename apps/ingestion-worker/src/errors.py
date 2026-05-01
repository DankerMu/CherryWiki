from __future__ import annotations

import traceback
from typing import Any


class IngestionJobError(Exception):
    def __init__(
        self,
        error_type: str,
        message: str,
        *,
        retryable: bool = True,
        cause: BaseException | None = None,
        duration_ms: int | None = None,
    ) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.retryable = retryable
        self.cause = cause
        self.duration_ms = duration_ms


class ParseTimeoutError(TimeoutError):
    pass


def build_error_json(exc: BaseException) -> dict[str, Any]:
    if isinstance(exc, IngestionJobError):
        error_type = exc.error_type
        error_message = str(exc)
        duration_ms = exc.duration_ms
        cause = exc.cause
    else:
        error_type = "worker_error"
        error_message = str(exc)
        duration_ms = None
        cause = exc

    payload: dict[str, Any] = {
        "error_type": error_type,
        "error_message": error_message,
        "stderr": getattr(cause, "stderr", None),
        "exit_code": getattr(cause, "returncode", None),
        "stack_trace": "".join(traceback.format_exception(exc)),
    }
    if duration_ms is not None:
        payload["duration_ms"] = duration_ms
    return payload
