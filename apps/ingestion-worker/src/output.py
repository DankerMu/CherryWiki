from __future__ import annotations

import datetime as dt
import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .parsers.base_parser import ParseResult


@dataclass(frozen=True, slots=True)
class ParsedArtifacts:
    parsed_markdown: str
    preview_text: str
    metadata: dict[str, Any]


def sha256_bytes(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_parsed_artifacts(
    *,
    parse_result: ParseResult,
    job: dict[str, Any],
    payload: dict[str, Any],
    filename: str,
    source_type: str,
    sha256: str,
    duration_ms: int,
) -> ParsedArtifacts:
    body = parse_result.content
    preview_text = body[:500]
    parsed_md_hash = sha256_bytes(body.encode("utf-8"))
    preview_hash = sha256_bytes(preview_text.encode("utf-8"))
    parser_metadata = parse_result.metadata

    metadata: dict[str, Any] = {
        "source_document_id": payload.get("source_document_id"),
        "filename": filename,
        "original_filename": filename,
        "source_type": source_type,
        "uploaded_by": payload.get("uploaded_by") or job.get("created_by"),
        "space_id": payload.get("space_id") or job.get("space_id"),
        "sha256": sha256,
        "parsed_md_hash": parsed_md_hash,
        "preview_hash": preview_hash,
        "parsed_at": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
        "extraction_tool": parser_metadata.get("extraction_tool", "unknown"),
        "extraction_version": parser_metadata.get("extraction_version", "unknown"),
        "extraction_tool_version": parser_metadata.get("extraction_version", "unknown"),
        "extraction_params": parser_metadata.get("extraction_params", {}),
        "extraction_duration_ms": duration_ms,
        "page_count": int(parser_metadata.get("page_count") or 1),
        "char_count": int(parser_metadata.get("char_count") or len(body)),
        "image_count": int(parser_metadata.get("image_count") or 0),
    }
    for key in ("ocr_used", "zip_member"):
        if key in parser_metadata:
            metadata[key] = parser_metadata[key]

    frontmatter = yaml.safe_dump(metadata, sort_keys=False, allow_unicode=True).strip()
    parsed_markdown = f"---\n{frontmatter}\n---\n\n{body}"
    return ParsedArtifacts(parsed_markdown=parsed_markdown, preview_text=preview_text, metadata=metadata)


def derive_artifact_key(archive_key: str, sha256: str, suffix: str) -> str:
    directory = archive_key.rsplit("/", 1)[0] if "/" in archive_key else "archive"
    return f"{directory}/{sha256.lower()}.{suffix}"
