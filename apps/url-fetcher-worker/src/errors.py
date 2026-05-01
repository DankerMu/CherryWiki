from __future__ import annotations

import traceback
from typing import Any


class UrlFetchJobError(Exception):
    def __init__(
        self,
        error_type: str,
        message: str,
        *,
        retryable: bool = True,
        cause: BaseException | None = None,
        **metadata: Any,
    ) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.retryable = retryable
        self.cause = cause
        self.metadata = {
            key: value for key, value in metadata.items() if value is not None
        }


class SsrfBlockedError(UrlFetchJobError):
    def __init__(
        self,
        message: str,
        *,
        target_url: str,
        resolved_ip: str | None,
        block_reason: str,
        redirect_chain: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(
            "ssrf_blocked",
            message,
            retryable=False,
            target_url=target_url,
            resolved_ip=resolved_ip,
            block_reason=block_reason,
            redirect_chain=redirect_chain or [],
        )


class FetchError(UrlFetchJobError):
    def __init__(
        self,
        message: str,
        *,
        retryable: bool = True,
        cause: BaseException | None = None,
        **metadata: Any,
    ) -> None:
        super().__init__(
            "fetch_error", message, retryable=retryable, cause=cause, **metadata
        )


class ConnectionTimeoutError(UrlFetchJobError):
    def __init__(
        self, message: str, *, cause: BaseException | None = None, **metadata: Any
    ) -> None:
        super().__init__(
            "connection_timeout", message, retryable=True, cause=cause, **metadata
        )


class RequestTimeoutError(UrlFetchJobError):
    def __init__(
        self, message: str, *, cause: BaseException | None = None, **metadata: Any
    ) -> None:
        super().__init__(
            "request_timeout", message, retryable=True, cause=cause, **metadata
        )


class ResponseTooLargeError(UrlFetchJobError):
    def __init__(self, message: str, **metadata: Any) -> None:
        super().__init__("response_too_large", message, retryable=False, **metadata)


class TooManyRedirectsError(UrlFetchJobError):
    def __init__(self, message: str, **metadata: Any) -> None:
        super().__init__("too_many_redirects", message, retryable=False, **metadata)


def build_error_json(exc: BaseException) -> dict[str, Any]:
    if isinstance(exc, UrlFetchJobError):
        error_type = exc.error_type
        error_message = str(exc)
        retryable_metadata = exc.metadata
        cause = exc.cause
    else:
        error_type = "worker_error"
        error_message = str(exc)
        retryable_metadata = {}
        cause = exc

    payload: dict[str, Any] = {
        "error_type": error_type,
        "error_message": error_message,
        "stack_trace": "".join(traceback.format_exception(exc)),
    }
    payload.update(retryable_metadata)
    if cause is not None:
        payload["cause"] = str(cause)
    return payload
