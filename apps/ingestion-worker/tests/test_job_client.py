from __future__ import annotations

from src.job_client import _parse_pending_job, _normalize_api_base_url


def test_parse_pending_job_handles_wrapped_list() -> None:
    assert _parse_pending_job([{"job_id": "job-1"}]) == {"job_id": "job-1"}


def test_api_base_url_defaults_to_api_prefix() -> None:
    assert _normalize_api_base_url("http://cherry-api:8080") == "http://cherry-api:8080/api"
    assert _normalize_api_base_url("http://cherry-api:8080/api") == "http://cherry-api:8080/api"
