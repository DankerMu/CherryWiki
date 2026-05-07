from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from src import runner
from tests.test_runner import (
    fixture_count,
    install_fake_run_graphify,
    install_runner_config,
)


def test_runner_integration_with_prepared_graphify_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = IntegrationStorage()

    class StorageFactory:
        @classmethod
        def from_env(cls) -> IntegrationStorage:
            return storage

    install_runner_config(monkeypatch, tmp_path)
    monkeypatch.setattr(runner, "MinioStorageClient", StorageFactory)

    install_fake_run_graphify(
        monkeypatch,
        expected_run_id="run-integration",
    )

    result = asyncio.run(
        runner.run(
            {
                "id": "job-integration",
                "payload_json": {
                    "tenant_id": "tenant-1",
                    "space_id": "space-1",
                    "run_id": "run-integration",
                    "input_uris": ["s3://input-bucket/doc/parsed.md"],
                },
            }
        )
    )

    assert result["status"] == "success"
    assert result["stats_json"]["node_count"] == fixture_count("nodes")
    assert result["stats_json"]["edge_count"] == fixture_count("edges")
    assert result["stats_json"]["wiki_page_count"] == 5
    assert storage.validation_report["validation_passed"] is True
    assert storage.validation_report["node_count"] == fixture_count("nodes")
    assert "graphify-out/tenant-1/space-1/run-integration/graph.json" in (
        storage.uploaded_keys
    )
    assert "graphify-out/tenant-1/space-1/run-integration/wiki/index.md" in (
        storage.uploaded_keys
    )
    assert not (tmp_path / "run-integration").exists()


class IntegrationStorage:
    def __init__(self) -> None:
        self.uploaded_keys: list[str] = []
        self.validation_report: dict[str, Any] = {}

    def download_file(self, _uri: str, local_path: Path) -> None:
        local_path.write_text("# parsed", encoding="utf-8")

    def upload_directory(self, local_dir: Path, _bucket: str, key_prefix: str) -> None:
        for path in sorted(local_dir.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(local_dir).as_posix()
            self.uploaded_keys.append(f"{key_prefix}/{rel}")
            if rel == "validation_report.json":
                self.validation_report = json.loads(path.read_text(encoding="utf-8"))
