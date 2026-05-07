from __future__ import annotations

import datetime as dt
import json
import logging
import os
import re
import shutil
import stat
from pathlib import Path
from typing import Any

from . import claude_runner
from .manifest import generate_manifest
from .storage_client import MinioStorageClient, parse_storage_uri

logger = logging.getLogger(__name__)

GRAPHIFY_WORKDIR = os.environ.get("GRAPHIFY_WORKDIR", "/tmp/graphify-workdir")
GRAPHIFY_TIMEOUT = int(os.environ.get("GRAPHIFY_TIMEOUT_SECONDS", "3600"))
GRAPHIFY_MODE = os.environ.get("GRAPHIFY_DEFAULT_MODE", "full")
GRAPHIFY_REF = os.environ.get("GRAPHIFY_PINNED_REF")
MAX_FILE_SIZE = 100 * 1024 * 1024
MAX_TOTAL_SIZE = 1024 * 1024 * 1024
OUTPUT_BUCKET = os.environ.get("GRAPHIFY_OUTPUT_BUCKET", "cherrywiki-graphify-out")
_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


async def run(job_data: dict[str, Any]) -> dict[str, Any]:
    if os.environ.get("GRAPHIFY_RUNNER_MODE", "claude_code") == "disabled":
        raise RuntimeError(json.dumps({"reason": "runner_disabled", "retryable": True}))
    if not os.environ.get("AGENT_ANTHROPIC_API_KEY") or not os.environ.get(
        "AGENT_ANTHROPIC_BASE_URL"
    ):
        raise RuntimeError(json.dumps({"reason": "missing_api_key"}))

    job_id = job_data.get("id") or job_data.get("job_id")
    payload = _payload(job_data)
    tenant_id = _safe_id(
        str(payload.get("tenant_id") or job_data.get("tenant_id") or "default")
    )
    space_id = _safe_id(str(payload.get("space_id") or job_data.get("space_id") or ""))
    run_id = _safe_id(str(payload.get("run_id") or job_id))
    mode = str(payload.get("mode") or GRAPHIFY_MODE)
    input_uris = _input_uris(payload)

    base = Path(GRAPHIFY_WORKDIR).resolve()
    workdir = (base / run_id).resolve()
    if not workdir.is_relative_to(base):
        raise ValueError(f"workdir escapes base: {workdir}")

    input_dir = workdir / "input"
    key_prefix = f"graphify-out/{tenant_id}/{space_id}/{run_id}"

    logger.info(
        "starting graphify job",
        extra={"job_id": job_id, "run_id": run_id, "input_count": len(input_uris)},
    )

    try:
        input_dir.mkdir(parents=True, exist_ok=True)

        storage = MinioStorageClient.from_env()
        input_files = _download_inputs(storage, input_uris, input_dir)

        manifest = generate_manifest(space_id, run_id, mode, input_files, GRAPHIFY_REF)
        manifest_path = workdir / "graphify_input_manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        result = await claude_runner.run_graphify(
            run_id, str(input_dir), timeout=GRAPHIFY_TIMEOUT
        )
        if result.get("status") != "success":
            raise RuntimeError(json.dumps(result))

        output_dir = _output_dir_from_result(result)
        if output_dir.is_symlink():
            raise RuntimeError(
                json.dumps({"reason": "output_dir_symlink", "path": str(output_dir)})
            )

        validation = _validate_output(
            output_dir, run_id=run_id, graphify_ref=GRAPHIFY_REF
        )
        report_path = output_dir / "validation_report.json"
        _write_validation_report(report_path, validation)
        if not validation["validation_passed"]:
            try:
                storage.upload_file(
                    report_path, OUTPUT_BUCKET, f"{key_prefix}/validation_report.json"
                )
            except Exception:
                logger.warning("Failed to upload validation report", exc_info=True)
            raise RuntimeError(json.dumps(_validation_error(validation)))

        storage.upload_directory(output_dir, OUTPUT_BUCKET, key_prefix)

        base_uri = f"s3://{OUTPUT_BUCKET}/{key_prefix}"
        graph_html_path = output_dir / "graph.html"
        report_md_path = output_dir / "GRAPH_REPORT.md"

        return {
            "status": "success",
            "graph_json_uri": f"{base_uri}/graph.json",
            "wiki_output_uri": f"{base_uri}/wiki",
            "report_uri": f"{base_uri}/GRAPH_REPORT.md"
            if report_md_path.exists()
            else None,
            "graph_html_uri": f"{base_uri}/graph.html"
            if graph_html_path.exists()
            else None,
            "validation_report_uri": f"{base_uri}/validation_report.json",
            "stats_json": {
                "node_count": validation.get("node_count", 0),
                "edge_count": validation.get("edge_count", 0),
                "wiki_page_count": validation.get("wiki_page_count", 0),
                "total_output_bytes": validation.get("total_output_bytes", 0),
            },
            "schema_version": "v1",
        }
    finally:
        if workdir.exists():
            shutil.rmtree(workdir, ignore_errors=True)
        claude_run_dir = (
            Path(os.environ.get("GRAPHIFY_RUN_ROOT", "/work/graphify")).resolve()
            / run_id
        )
        if claude_run_dir.exists() and claude_run_dir != workdir:
            shutil.rmtree(claude_run_dir, ignore_errors=True)


def _safe_id(value: str) -> str:
    if not _SAFE_ID_RE.match(value):
        raise ValueError(f"Invalid id for path use: {value!r}")
    return value


def _write_validation_report(report_path: Path, validation: dict[str, Any]) -> None:
    if report_path.exists() or report_path.is_symlink():
        if report_path.is_dir() and not report_path.is_symlink():
            shutil.rmtree(report_path)
        else:
            report_path.unlink()
    report_path.write_text(json.dumps(validation, indent=2), encoding="utf-8")


def _validation_error(validation: dict[str, Any]) -> dict[str, Any]:
    failed_checks = [
        check for check in validation["checks"] if check["status"] == "failed"
    ]
    failed_check = failed_checks[0] if failed_checks else {}
    reason = failed_check.get("name", "validation_failed")
    details = failed_check.get("details", "")

    if reason in {"file_size", "total_size"}:
        return {
            "reason": "quarantined",
            "quarantine_type": reason,
            "details": details,
            "validation_report": validation,
        }

    if reason == "path_traversal":
        return {
            "reason": "path_traversal",
            "file": _failed_path_from_details(details),
            "validation_report": validation,
        }

    return {"reason": reason, "validation_report": validation}


def _failed_path_from_details(details: str) -> str:
    if ": " in details:
        return details.split(": ", 1)[1]
    return details


def _payload(job_data: dict[str, Any]) -> dict[str, Any]:
    payload = job_data.get("payload_json", job_data)
    if isinstance(payload, str):
        parsed = json.loads(payload)
        return parsed if isinstance(parsed, dict) else {}
    return payload if isinstance(payload, dict) else {}


def _input_uris(payload: dict[str, Any]) -> list[str]:
    direct = payload.get("input_uris") or payload.get("source_document_uris")
    if isinstance(direct, list):
        return [str(uri) for uri in direct if uri]

    source_documents = payload.get("source_documents")
    if isinstance(source_documents, list):
        uris: list[str] = []
        for source_document in source_documents:
            if not isinstance(source_document, dict):
                continue
            uri = (
                source_document.get("parsed_md_uri")
                or source_document.get("parsed_markdown_uri")
                or source_document.get("parsed_uri")
                or source_document.get("storage_uri")
                or source_document.get("uri")
            )
            if uri:
                uris.append(str(uri))
        return uris

    return []


def _download_inputs(
    storage: MinioStorageClient, input_uris: list[str], input_dir: Path
) -> list[Path]:
    input_files: list[Path] = []
    used_names: set[str] = set()
    for index, uri in enumerate(input_uris, start=1):
        try:
            ref = parse_storage_uri(uri)
            filename = Path(ref.key).name or f"input-{index}.md"
            if filename in used_names:
                local_name = f"{index:04d}-{filename}"
            else:
                local_name = filename
            used_names.add(local_name)
            local_path = input_dir / local_name
            storage.download_file(uri, local_path)
            input_files.append(local_path)
        except Exception as exc:
            raise RuntimeError(
                json.dumps({"reason": "download_failed", "uri": uri, "error": str(exc)})
            ) from exc
    return input_files


def _output_dir_from_result(result: dict[str, Any]) -> Path:
    output_dir = result.get("output_dir")
    if output_dir:
        return Path(str(output_dir))

    graph_json_path = result.get("graph_json_path")
    if graph_json_path:
        return Path(str(graph_json_path)).parent

    raise RuntimeError(json.dumps({"reason": "missing_output_dir", "result": result}))


def _validate_output(
    output_dir: Path, *, run_id: str | None = None, graphify_ref: str | None = None
) -> dict[str, Any]:
    checks: list[dict[str, str]] = []
    total_size = 0
    node_count = 0
    edge_count = 0
    wiki_page_count = 0

    output_root = output_dir.resolve()
    for path in output_dir.rglob("*"):
        rel = path.relative_to(output_dir)
        rel_str = rel.as_posix()
        path_stat = path.lstat()

        if ".." in rel.parts:
            checks.append(
                {
                    "name": "path_traversal",
                    "status": "failed",
                    "details": f"path traversal: {rel_str}",
                }
            )
            return _report(
                checks,
                False,
                node_count,
                edge_count,
                wiki_page_count,
                total_size,
                run_id,
                graphify_ref,
            )

        if stat.S_ISLNK(path_stat.st_mode):
            checks.append(
                {
                    "name": "path_traversal",
                    "status": "failed",
                    "details": f"symlink: {rel_str}",
                }
            )
            return _report(
                checks,
                False,
                node_count,
                edge_count,
                wiki_page_count,
                total_size,
                run_id,
                graphify_ref,
            )

        if not path.resolve().is_relative_to(output_root):
            checks.append(
                {
                    "name": "path_traversal",
                    "status": "failed",
                    "details": f"path escapes output directory: {rel_str}",
                }
            )
            return _report(
                checks,
                False,
                node_count,
                edge_count,
                wiki_page_count,
                total_size,
                run_id,
                graphify_ref,
            )

        if not stat.S_ISREG(path_stat.st_mode):
            continue

        size = path_stat.st_size
        total_size += size
        if size > MAX_FILE_SIZE:
            checks.append(
                {
                    "name": "file_size",
                    "status": "failed",
                    "details": f"{rel_str}: {size} bytes > {MAX_FILE_SIZE}",
                }
            )
            return _report(
                checks,
                False,
                node_count,
                edge_count,
                wiki_page_count,
                total_size,
                run_id,
                graphify_ref,
            )

    if total_size > MAX_TOTAL_SIZE:
        checks.append(
            {
                "name": "total_size",
                "status": "failed",
                "details": f"total {total_size} bytes > {MAX_TOTAL_SIZE}",
            }
        )
        return _report(
            checks,
            False,
            node_count,
            edge_count,
            wiki_page_count,
            total_size,
            run_id,
            graphify_ref,
        )

    checks.append(
        {
            "name": "size_limits",
            "status": "passed",
            "details": f"total {total_size} bytes",
        }
    )

    graph_json = output_dir / "graph.json"
    if graph_json.exists():
        try:
            data = json.loads(graph_json.read_text(encoding="utf-8"))
            nodes = data.get("nodes", []) if isinstance(data, dict) else []
            edges = (
                data.get("links", data.get("edges", []))
                if isinstance(data, dict)
                else []
            )
            node_count = len(nodes) if isinstance(nodes, list) else 0
            edge_count = len(edges) if isinstance(edges, list) else 0
            checks.append(
                {
                    "name": "graph_json_exists",
                    "status": "passed",
                    "details": f"{node_count} nodes, {edge_count} edges",
                }
            )
        except (json.JSONDecodeError, OSError) as exc:
            checks.append(
                {
                    "name": "graph_json_exists",
                    "status": "failed",
                    "details": f"Invalid JSON: {exc}",
                }
            )
    else:
        checks.append(
            {
                "name": "missing_graph_json",
                "status": "failed",
                "details": "graph.json not found",
            }
        )

    wiki_dir = output_dir / "wiki"
    if wiki_dir.is_dir():
        md_files = [path for path in wiki_dir.glob("*.md") if path.is_file()]
        wiki_page_count = len(md_files)
        if wiki_page_count > 0:
            checks.append(
                {
                    "name": "wiki_dir_exists",
                    "status": "passed",
                    "details": f"{wiki_page_count} pages",
                }
            )
        else:
            checks.append(
                {
                    "name": "missing_wiki_dir",
                    "status": "failed",
                    "details": "wiki/ exists but contains no .md files",
                }
            )
    else:
        checks.append(
            {
                "name": "missing_wiki_dir",
                "status": "failed",
                "details": "wiki/ not found",
            }
        )

    report = output_dir / "GRAPH_REPORT.md"
    if report.exists():
        checks.append({"name": "report_exists", "status": "passed", "details": ""})
    else:
        checks.append(
            {
                "name": "report_exists",
                "status": "passed",
                "details": "GRAPH_REPORT.md missing (non-fatal warning)",
            }
        )

    has_failures = any(check["status"] == "failed" for check in checks)
    return _report(
        checks,
        not has_failures,
        node_count,
        edge_count,
        wiki_page_count,
        total_size,
        run_id,
        graphify_ref,
    )


def _report(
    checks: list[dict[str, str]],
    passed: bool,
    node_count: int,
    edge_count: int,
    wiki_page_count: int,
    total_size: int,
    run_id: str | None,
    graphify_ref: str | None,
) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "graphify_ref": graphify_ref,
        "validation_passed": passed,
        "checks": checks,
        "node_count": node_count,
        "edge_count": edge_count,
        "wiki_page_count": wiki_page_count,
        "total_output_bytes": total_size,
        "generated_at": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
    }
