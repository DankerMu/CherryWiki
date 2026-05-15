from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path
from typing import Any, Callable

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

    def build_output(input_dir: Path, output_dir: Path) -> None:
        captured_manifest.update(
            json.loads(
                (input_dir.parent / "graphify_input_manifest.json").read_text(
                    encoding="utf-8"
                )
            )
        )
        shutil.copytree(FIXTURE_OUTPUT, output_dir, dirs_exist_ok=True)

    install_fake_run_graphify(monkeypatch, build_output)

    result = asyncio.run(runner.run(job_data()))

    assert result["status"] == "success"
    assert result["schema_version"] == "v1"
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
    assert set(result["stats_json"]) == {
        "node_count",
        "edge_count",
        "wiki_page_count",
        "total_output_bytes",
        "input_file_count",
        "input_total_words",
        "claude_session_id",
        "duration_ms",
        "empty_output_count",
        "timeout_count",
        "requires_interaction_count",
        "validation_failed_reason",
    }
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

    def build_output(_input_dir: Path, output_dir: Path) -> None:
        shutil.copytree(FIXTURE_OUTPUT, output_dir, dirs_exist_ok=True)
        (output_dir / "GRAPH_REPORT.md").unlink()

    install_fake_run_graphify(monkeypatch, build_output)

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


def test_run_disabled_mode_fails_before_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)
    monkeypatch.setenv("GRAPHIFY_RUNNER_MODE", "disabled")

    async def fail_run_graphify(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise AssertionError("disabled runner must not call Claude runner")

    monkeypatch.setattr(runner.claude_runner, "run_graphify", fail_run_graphify)

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(runner.run(job_data()))

    error = json.loads(str(exc_info.value))
    assert error["reason"] == "runner_disabled"
    assert error["retryable"] is True
    assert error["stats_json"]["duration_ms"] > 0
    assert storage.downloads == []
    assert not any(tmp_path.iterdir())


def test_run_missing_api_key_fails_before_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)
    monkeypatch.setenv("GRAPHIFY_RUNNER_MODE", "claude_code")
    monkeypatch.delenv("AGENT_ANTHROPIC_API_KEY", raising=False)

    async def fail_run_graphify(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise AssertionError("missing API key must not call Claude runner")

    monkeypatch.setattr(runner.claude_runner, "run_graphify", fail_run_graphify)

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(runner.run(job_data()))

    error = json.loads(str(exc_info.value))
    assert error["reason"] == "missing_api_key"
    assert error["stats_json"]["duration_ms"] > 0
    assert storage.downloads == []
    assert not any(tmp_path.iterdir())


def test_run_pipeline_error_reports_and_cleans_workdir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)

    async def fake_run_graphify(
        _run_id: str, _input_dir: str, *, timeout: float | None = None
    ) -> dict[str, Any]:
        assert timeout == 5
        return {
            "status": "failed",
            "state": "FAILED",
            "reason": "llm_error",
            "details": "API unreachable",
        }

    monkeypatch.setattr(runner.claude_runner, "run_graphify", fake_run_graphify)

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(runner.run(job_data()))

    assert json.loads(str(exc_info.value))["reason"] == "llm_error"
    assert not (tmp_path / "run-1").exists()


def test_run_stats_contains_claude_metrics(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)
    install_fake_run_graphify(
        monkeypatch,
        input_file_count=2,
        input_total_words=7,
        claude_session_id="session-1",
        timeout_count=1,
        requires_interaction_count=3,
    )

    result = asyncio.run(runner.run(job_data()))

    stats = result["stats_json"]
    assert stats["input_file_count"] == 2
    assert stats["input_total_words"] == 7
    assert stats["claude_session_id"] == "session-1"
    assert stats["timeout_count"] == 1
    assert stats["requires_interaction_count"] == 3


def test_run_duration_ms_is_positive_on_success_and_exception(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)
    install_fake_run_graphify(monkeypatch)

    result = asyncio.run(runner.run(job_data()))

    assert isinstance(result["stats_json"]["duration_ms"], int)
    assert result["stats_json"]["duration_ms"] > 0

    install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)

    async def fake_run_graphify(
        _run_id: str, _input_dir: str, *, timeout: float | None = None
    ) -> dict[str, Any]:
        return {
            "status": "failed",
            "state": "FAILED",
            "reason": "llm_error",
            "input_file_count": 2,
            "input_total_words": 4,
            "claude_session_id": None,
            "timeout_count": 0,
            "requires_interaction_count": 0,
        }

    monkeypatch.setattr(runner.claude_runner, "run_graphify", fake_run_graphify)

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(runner.run(job_data()))

    stats = json.loads(str(exc_info.value))["stats_json"]
    assert isinstance(stats["duration_ms"], int)
    assert stats["duration_ms"] > 0


def test_run_empty_graph_sets_empty_output_count(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)

    def build_output(_input_dir: Path, output_dir: Path) -> None:
        (output_dir / "graph.json").write_text(
            '{"nodes":[],"edges":[]}', encoding="utf-8"
        )
        wiki_dir = output_dir / "wiki"
        wiki_dir.mkdir(parents=True)
        (wiki_dir / "index.md").write_text("# Index", encoding="utf-8")
        (output_dir / "GRAPH_REPORT.md").write_text("report", encoding="utf-8")

    install_fake_run_graphify(monkeypatch, build_output)

    result = asyncio.run(runner.run(job_data()))

    assert result["stats_json"]["empty_output_count"] == 1


def test_run_missing_graph_sets_empty_output_count(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)

    def build_output(_input_dir: Path, output_dir: Path) -> None:
        wiki_dir = output_dir / "wiki"
        wiki_dir.mkdir(parents=True)
        (wiki_dir / "index.md").write_text("# Index", encoding="utf-8")
        (output_dir / "GRAPH_REPORT.md").write_text("report", encoding="utf-8")

    install_fake_run_graphify(monkeypatch, build_output)

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(runner.run(job_data()))

    stats = json.loads(str(exc_info.value))["stats_json"]
    assert stats["empty_output_count"] == 1


def test_run_validation_failure_sets_failed_reason(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)

    def build_output(_input_dir: Path, output_dir: Path) -> None:
        (output_dir / "graph.json").write_text(
            '{"nodes":[{"id":"a"}],"edges":[]}', encoding="utf-8"
        )
        (output_dir / "GRAPH_REPORT.md").write_text("report", encoding="utf-8")

    install_fake_run_graphify(monkeypatch, build_output)

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(runner.run(job_data()))

    stats = json.loads(str(exc_info.value))["stats_json"]
    assert stats["validation_failed_reason"] == "missing_wiki_dir: wiki/ not found"


def test_run_validation_success_sets_failed_reason_none(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)
    install_fake_run_graphify(monkeypatch)

    result = asyncio.run(runner.run(job_data()))

    assert result["stats_json"]["validation_failed_reason"] is None


def test_run_missing_graph_json_fails_validation_and_cleans_workdir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = install_fake_storage(monkeypatch)
    install_runner_config(monkeypatch, tmp_path)

    def build_output(_input_dir: Path, output_dir: Path) -> None:
        (output_dir / "wiki").mkdir(parents=True)
        (output_dir / "wiki" / "index.md").write_text("# Index", encoding="utf-8")
        (output_dir / "GRAPH_REPORT.md").write_text("report", encoding="utf-8")

    install_fake_run_graphify(monkeypatch, build_output)

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

    def build_output(_input_dir: Path, output_dir: Path) -> None:
        (output_dir / "graph.json").write_text(
            '{"nodes":[],"edges":[]}', encoding="utf-8"
        )
        (output_dir / "GRAPH_REPORT.md").write_text("report", encoding="utf-8")

    install_fake_run_graphify(monkeypatch, build_output)

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

    def build_output(_input_dir: Path, output_dir: Path) -> None:
        shutil.copytree(FIXTURE_OUTPUT, output_dir, dirs_exist_ok=True)
        try:
            (output_dir / "wiki" / "escape.md").symlink_to(outside)
        except OSError as exc:
            pytest.skip(f"symlink not available: {exc}")

    install_fake_run_graphify(monkeypatch, build_output)

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

    install_fake_run_graphify(monkeypatch)

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

    install_fake_run_graphify(monkeypatch)

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


def test_validate_output_counts_links_field(tmp_path: Path) -> None:
    output_dir = tmp_path / "graphify-out"
    shutil.copytree(FIXTURE_OUTPUT, output_dir)
    graph_path = output_dir / "graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    graph["links"] = graph.pop("edges")
    graph_path.write_text(json.dumps(graph), encoding="utf-8")

    validation = runner._validate_output(output_dir, run_id="run-1")

    assert validation["validation_passed"] is True
    assert validation["edge_count"] == len(graph["links"])


def install_runner_config(
    monkeypatch: pytest.MonkeyPatch, workdir: Path, *, output_bucket: str = "out-bucket"
) -> None:
    monkeypatch.setenv("GRAPHIFY_RUNNER_MODE", "claude_code")
    monkeypatch.setenv("AGENT_ANTHROPIC_API_KEY", "test-agent-key")
    monkeypatch.setenv("AGENT_ANTHROPIC_BASE_URL", "https://test-proxy.example.com")
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
    if key == "edges":
        return len(graph.get("links", graph.get("edges", [])))
    return len(graph[key])


def install_fake_run_graphify(
    monkeypatch: pytest.MonkeyPatch,
    build_output: Callable[[Path, Path], None] | None = None,
    *,
    expected_run_id: str = "run-1",
    input_file_count: int = 2,
    input_total_words: int = 6,
    claude_session_id: str | None = "session-1",
    timeout_count: int = 0,
    requires_interaction_count: int = 0,
) -> None:
    async def fake_run_graphify(
        run_id: str, input_dir: str, *, timeout: float | None = None
    ) -> dict[str, Any]:
        assert run_id == expected_run_id
        assert timeout == 5
        input_path = Path(input_dir)
        output_dir = input_path.parent / "session" / "graphify-out"
        output_dir.mkdir(parents=True, exist_ok=True)
        if build_output is None:
            shutil.copytree(FIXTURE_OUTPUT, output_dir, dirs_exist_ok=True)
        else:
            build_output(input_path, output_dir)
        return success_run_graphify_result(
            output_dir,
            input_file_count=input_file_count,
            input_total_words=input_total_words,
            claude_session_id=claude_session_id,
            timeout_count=timeout_count,
            requires_interaction_count=requires_interaction_count,
        )

    monkeypatch.setattr(runner.claude_runner, "run_graphify", fake_run_graphify)


def success_run_graphify_result(
    output_dir: Path,
    *,
    input_file_count: int = 2,
    input_total_words: int = 6,
    claude_session_id: str | None = "session-1",
    timeout_count: int = 0,
    requires_interaction_count: int = 0,
) -> dict[str, Any]:
    return {
        "status": "success",
        "state": "SUCCEEDED",
        "session_id": claude_session_id,
        "claude_session_id": claude_session_id,
        "output_dir": str(output_dir),
        "graph_json_path": str(output_dir / "graph.json"),
        "wiki_output_path": str(output_dir / "wiki"),
        "report_path": str(output_dir / "GRAPH_REPORT.md"),
        "input_file_count": input_file_count,
        "input_total_words": input_total_words,
        "timeout_count": timeout_count,
        "requires_interaction_count": requires_interaction_count,
    }


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
