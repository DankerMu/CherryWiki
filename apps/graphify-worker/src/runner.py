from __future__ import annotations

import datetime as dt
import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

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


async def run(job_data: dict[str, Any]) -> dict[str, Any]:
    job_id = job_data.get("id") or job_data.get("job_id")
    payload = _payload(job_data)
    tenant_id = str(payload.get("tenant_id") or job_data.get("tenant_id") or "default")
    space_id = str(payload.get("space_id") or job_data.get("space_id") or "")
    run_id = str(payload.get("run_id") or job_id)
    mode = str(payload.get("mode") or GRAPHIFY_MODE)
    input_uris = _input_uris(payload)

    workdir = Path(GRAPHIFY_WORKDIR) / run_id
    input_dir = workdir / "input"
    output_dir = workdir / "output"

    logger.info(
        "starting graphify job",
        extra={"job_id": job_id, "run_id": run_id, "input_count": len(input_uris)},
    )

    try:
        input_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)

        storage = MinioStorageClient.from_env()
        input_files = _download_inputs(storage, input_uris, input_dir)

        manifest = generate_manifest(space_id, run_id, mode, input_files, GRAPHIFY_REF)
        manifest_path = workdir / "graphify_input_manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        cmd = [
            "graphify",
            "--wiki",
            "--mode",
            mode,
            "--output",
            str(output_dir),
            str(input_dir),
        ]
        if GRAPHIFY_REF:
            cmd.extend(["--ref", GRAPHIFY_REF])

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=GRAPHIFY_TIMEOUT,
                cwd=str(workdir),
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                json.dumps({"reason": "timeout", "timeout_seconds": GRAPHIFY_TIMEOUT})
            ) from exc

        if result.returncode != 0:
            raise RuntimeError(
                json.dumps(
                    {
                        "reason": "cli_error",
                        "exit_code": result.returncode,
                        "stderr": result.stderr[:2000],
                    }
                )
            )

        validation = _validate_output(
            output_dir, run_id=run_id, graphify_ref=GRAPHIFY_REF
        )
        report_path = output_dir / "validation_report.json"
        report_path.write_text(json.dumps(validation, indent=2), encoding="utf-8")
        if not validation["validation_passed"]:
            failed_checks = [
                check for check in validation["checks"] if check["status"] == "failed"
            ]
            reason = failed_checks[0]["name"] if failed_checks else "validation_failed"
            raise RuntimeError(
                json.dumps({"reason": reason, "validation_report": validation})
            )

        key_prefix = f"graphify-out/{tenant_id}/{space_id}/{run_id}"
        storage.upload_directory(output_dir, OUTPUT_BUCKET, key_prefix)

        base_uri = f"s3://{OUTPUT_BUCKET}/{key_prefix}"
        graph_html_path = output_dir / "graph.html"

        return {
            "status": "success",
            "graph_json_uri": f"{base_uri}/graph.json",
            "wiki_output_uri": f"{base_uri}/wiki",
            "report_uri": f"{base_uri}/GRAPH_REPORT.md",
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
        }
    finally:
        if workdir.exists():
            shutil.rmtree(workdir, ignore_errors=True)


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
                json.dumps(
                    {"reason": "download_failed", "uri": uri, "error": str(exc)}
                )
            ) from exc
    return input_files


def _validate_output(
    output_dir: Path, *, run_id: str | None = None, graphify_ref: str | None = None
) -> dict[str, Any]:
    checks: list[dict[str, str]] = []
    total_size = 0
    node_count = 0
    edge_count = 0
    wiki_page_count = 0

    graph_json = output_dir / "graph.json"
    if graph_json.exists():
        try:
            data = json.loads(graph_json.read_text(encoding="utf-8"))
            nodes = data.get("nodes", []) if isinstance(data, dict) else []
            edges = data.get("edges", []) if isinstance(data, dict) else []
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

    output_root = output_dir.resolve()
    for path in output_dir.rglob("*"):
        rel = path.relative_to(output_dir)
        rel_str = rel.as_posix()

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

        if path.is_symlink():
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

        try:
            path.resolve().relative_to(output_root)
        except ValueError:
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

        if not path.is_file():
            continue

        size = path.stat().st_size
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
