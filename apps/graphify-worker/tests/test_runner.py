from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path
from typing import Any

import pytest

from src import runner

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_OUTPUT = REPO_ROOT / "tests" / "fixtures" / "test-graphify-output"


def test_run_success_uploads_outputs_and_cleans_workdir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)
    captured_manifest: dict[str, Any] = {}

    async def fake_execute(input_dir: Path, output_dir: Path, mode: str) -> None:
        captured_manifest.update(
            json.loads(
                (input_dir.parent / "graphify_input_manifest.json").read_text(
                    encoding="utf-8"
                )
            )
        )
        shutil.copytree(FIXTURE_OUTPUT, output_dir, dirs_exist_ok=True)

    monkeypatch.setattr(runner.graphify_pipeline, "execute", fake_execute)

    result = asyncio.run(runner.run(job_data()))

    assert result["status"] == "success"
    assert result["graph_json_uri"] == (
        "s3://out-bucket/graphify-out/tenant-1/space-1/run-1/graph.json"
    )
    assert result["wiki_output_uri"] == (
        "s3://out-bucket/graphify-out/tenant-1/space-1/run-1/wiki"
    )
    assert result["report_uri"] == (
        "s3://out-bucket/graphify-out/tenant-1/space-1/run-1/GRAPH_REPORT.md"
    )
    assert result["graph_html_uri"] is None
    assert result["stats_json"]["node_count"] == fixture_count("nodes")
    assert result["stats_json"]["edge_count"] == fixture_count("edges")
    assert result["stats_json"]["wiki_page_count"] == 5
    assert captured_manifest["space_id"] == "space-1"
    assert captured_manifest["run_id"] == "run-1"
    assert captured_manifest["mode"] == "full"
    assert captured_manifest["graphify_ref"] == "graphify-ref"
    assert len(captured_manifest["input_files"]) == 2
    assert storage.downloads == [
        "s3://input-bucket/doc-a/parsed.md",
        "s3://input-bucket/doc-b/parsed.md",
    ]
    assert "graphify-out/tenant-1/space-1/run-1/graph.json" in storage.uploaded_keys
    assert "graphify-out/tenant-1/space-1/run-1/validation_report.json" in (
        storage.uploaded_keys
    )
    assert "graphify-out/tenant-1/space-1/run-1/wiki/index.md" in storage.uploaded_keys
    assert storage.uploaded_validation_report["validation_passed"] is True
    assert not (tmp_path / "run-1").exists()


def test_run_success_omits_report_uri_when_report_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)

    async def fake_execute(input_dir: Path, output_dir: Path, mode: str) -> None:
        shutil.copytree(FIXTURE_OUTPUT, output_dir, dirs_exist_ok=True)
        (output_dir / "GRAPH_REPORT.md").unlink()

    monkeypatch.setattr(runner.graphify_pipeline, "execute", fake_execute)

    result = asyncio.run(runner.run(job_data()))

    assert result["status"] == "success"
    assert result["report_uri"] is None


@pytest.mark.parametrize("run_id", ["../../etc", "/tmp/evil", "../escape"])
def test_run_rejects_unsafe_run_id(
    run_id: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_runner_config(monkeypatch, tmp_path)
    data = job_data()
    data["payload_json"]["run_id"] = run_id

    with pytest.raises(ValueError, match="Invalid id for path use"):
        asyncio.run(runner.run(data))

    assert not any(tmp_path.iterdir())


def test_run_pipeline_error_reports_and_cleans_workdir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)

    async def fake_execute(input_dir: Path, output_dir: Path, mode: str) -> None:
        raise RuntimeError(
            json.dumps({"reason": "llm_error", "details": "API unreachable"})
        )

    monkeypatch.setattr(runner.graphify_pipeline, "execute", fake_execute)

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(runner.run(job_data()))

    assert json.loads(str(exc_info.value))["reason"] == "llm_error"
    assert not (tmp_path / "run-1").exists()


def test_run_missing_graph_json_fails_validation_and_cleans_workdir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)

    async def fake_execute(input_dir: Path, output_dir: Path, mode: str) -> None:
        (output_dir / "wiki").mkdir(parents=True)
        (output_dir / "wiki" / "index.md").write_text("# Index", encoding="utf-8")
        (output_dir / "GRAPH_REPORT.md").write_text("report", encoding="utf-8")

    monkeypatch.setattr(runner.graphify_pipeline, "execute", fake_execute)

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(runner.run(job_data()))

    error = json.loads(str(exc_info.value))
    assert error["reason"] == "missing_graph_json"
    assert storage.uploaded_keys == [
        "graphify-out/tenant-1/space-1/run-1/validation_report.json"
    ]
    assert storage.uploaded_validation_report["validation_passed"] is False
    assert not (tmp_path / "run-1").exists()


def test_run_missing_wiki_dir_fails_validation_and_cleans_workdir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)

    async def fake_execute(input_dir: Path, output_dir: Path, mode: str) -> None:
        (output_dir / "graph.json").write_text(
            '{"nodes":[],"edges":[]}', encoding="utf-8"
        )
        (output_dir / "GRAPH_REPORT.md").write_text("report", encoding="utf-8")

    monkeypatch.setattr(runner.graphify_pipeline, "execute", fake_execute)

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(runner.run(job_data()))

    assert json.loads(str(exc_info.value))["reason"] == "missing_wiki_dir"
    assert storage.uploaded_keys == [
        "graphify-out/tenant-1/space-1/run-1/validation_report.json"
    ]
    assert storage.uploaded_validation_report["validation_passed"] is False
    assert not (tmp_path / "run-1").exists()


def test_run_path_traversal_detection_fails_on_symlink_and_cleans_workdir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)

    outside = tmp_path / "outside.md"
    outside.write_text("outside", encoding="utf-8")

    async def fake_execute(input_dir: Path, output_dir: Path, mode: str) -> None:
        shutil.copytree(FIXTURE_OUTPUT, output_dir, dirs_exist_ok=True)
        try:
            (output_dir / "wiki" / "escape.md").symlink_to(outside)
        except OSError as exc:
            pytest.skip(f"symlink not available: {exc}")

    monkeypatch.setattr(runner.graphify_pipeline, "execute", fake_execute)

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(runner.run(job_data()))

    error = json.loads(str(exc_info.value))
    assert error["reason"] == "path_traversal"
    assert error["file"] == "wiki/escape.md"
    assert storage.uploaded_keys == [
        "graphify-out/tenant-1/space-1/run-1/validation_report.json"
    ]
    assert storage.uploaded_validation_report["validation_passed"] is False
    assert not (tmp_path / "run-1").exists()


def test_run_file_size_check_fails_validation_and_cleans_workdir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)
    monkeypatch.setattr(runner, "MAX_FILE_SIZE", 10)

    async def fake_execute(input_dir: Path, output_dir: Path, mode: str) -> None:
        shutil.copytree(FIXTURE_OUTPUT, output_dir, dirs_exist_ok=True)

    monkeypatch.setattr(runner.graphify_pipeline, "execute", fake_execute)

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(runner.run(job_data()))

    error = json.loads(str(exc_info.value))
    assert error["reason"] == "quarantined"
    assert error["quarantine_type"] == "file_size"
    assert error["details"]
    report = error["validation_report"]
    assert report["validation_passed"] is False
    assert any(check["name"] == "file_size" for check in report["checks"])
    assert storage.uploaded_keys == [
        "graphify-out/tenant-1/space-1/run-1/validation_report.json"
    ]
    assert storage.uploaded_validation_report["validation_passed"] is False
    assert not (tmp_path / "run-1").exists()


def test_run_total_size_check_uses_quarantine_error_shape(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)
    monkeypatch.setattr(runner, "MAX_TOTAL_SIZE", 10)

    async def fake_execute(input_dir: Path, output_dir: Path, mode: str) -> None:
        shutil.copytree(FIXTURE_OUTPUT, output_dir, dirs_exist_ok=True)

    monkeypatch.setattr(runner.graphify_pipeline, "execute", fake_execute)

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(runner.run(job_data()))

    error = json.loads(str(exc_info.value))
    assert error["reason"] == "quarantined"
    assert error["quarantine_type"] == "total_size"
    assert error["details"]
    assert error["validation_report"]["validation_passed"] is False
    assert storage.uploaded_keys == [
        "graphify-out/tenant-1/space-1/run-1/validation_report.json"
    ]
    assert storage.uploaded_validation_report["validation_passed"] is False
    assert not (tmp_path / "run-1").exists()


def test_validate_output_checks_size_before_parsing_graph_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(runner, "MAX_FILE_SIZE", 10)
    (tmp_path / "graph.json").write_text(
        "not valid json and too large", encoding="utf-8"
    )

    validation = runner._validate_output(tmp_path, run_id="run-1")

    assert validation["validation_passed"] is False
    failed_checks = [
        check for check in validation["checks"] if check["status"] == "failed"
    ]
    assert failed_checks[0]["name"] == "file_size"
    assert all(check["name"] != "graph_json_exists" for check in validation["checks"])


def test_validate_output_reports_pass_stats() -> None:
    validation = runner._validate_output(
        FIXTURE_OUTPUT, run_id="run-1", graphify_ref="graphify-ref"
    )

    assert validation["validation_passed"] is True
    assert validation["run_id"] == "run-1"
    assert validation["graphify_ref"] == "graphify-ref"
    assert validation["node_count"] == fixture_count("nodes")
    assert validation["edge_count"] == fixture_count("edges")
    assert validation["wiki_page_count"] == 5
    assert validation["generated_at"].endswith("Z")


def install_runner_config(
    monkeypatch: pytest.MonkeyPatch, workdir: Path, *, output_bucket: str = "out-bucket"
) -> None:
    monkeypatch.setattr(runner, "GRAPHIFY_WORKDIR", str(workdir))
    monkeypatch.setattr(runner, "GRAPHIFY_TIMEOUT", 5)
    monkeypatch.setattr(runner, "GRAPHIFY_MODE", "full")
    monkeypatch.setattr(runner, "GRAPHIFY_REF", "graphify-ref")
    monkeypatch.setattr(runner, "OUTPUT_BUCKET", output_bucket)
    monkeypatch.setattr(runner, "MAX_FILE_SIZE", 100 * 1024 * 1024)
    monkeypatch.setattr(runner, "MAX_TOTAL_SIZE", 1024 * 1024 * 1024)


def install_fake_storage(monkeypatch: pytest.MonkeyPatch) -> "FakeStorage":
    storage = FakeStorage()

    class FakeStorageFactory:
        @classmethod
        def from_env(cls) -> FakeStorage:
            return storage

    monkeypatch.setattr(runner, "MinioStorageClient", FakeStorageFactory)
    return storage


def job_data() -> dict[str, Any]:
    return {
        "id": "job-1",
        "payload_json": {
            "tenant_id": "tenant-1",
            "space_id": "space-1",
            "run_id": "run-1",
            "mode": "full",
            "input_uris": [
                "s3://input-bucket/doc-a/parsed.md",
                "s3://input-bucket/doc-b/parsed.md",
            ],
        },
    }


def fixture_count(key: str) -> int:
    graph = json.loads((FIXTURE_OUTPUT / "graph.json").read_text(encoding="utf-8"))
    return len(graph[key])


class FakeStorage:
    def __init__(self) -> None:
        self.downloads: list[str] = []
        self.uploaded_keys: list[str] = []
        self.uploaded_validation_report: dict[str, Any] = {}

    def download_file(self, uri: str, local_path: Path) -> None:
        self.downloads.append(uri)
        local_path.write_text(f"# {uri}", encoding="utf-8")

    def upload_file(self, local_path: Path, bucket: str, key: str) -> None:
        assert bucket == "out-bucket"
        self.uploaded_keys.append(key)
        if key.endswith("/validation_report.json"):
            self.uploaded_validation_report = json.loads(
                local_path.read_text(encoding="utf-8")
            )

    def upload_directory(self, local_dir: Path, bucket: str, key_prefix: str) -> None:
        for path in sorted(local_dir.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(local_dir).as_posix()
            key = f"{key_prefix}/{rel}"
            self.upload_file(path, bucket, key)
