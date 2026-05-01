from __future__ import annotations

import yaml

from src.output import build_parsed_artifacts
from src.parsers.base_parser import ParseResult


def test_parsed_markdown_frontmatter_is_complete() -> None:
    artifacts = build_parsed_artifacts(
        parse_result=ParseResult(
            content="Body text",
            metadata={
                "extraction_tool": "passthrough",
                "extraction_version": "1",
                "extraction_params": {"encoding": "utf-8"},
                "page_count": 1,
                "char_count": 9,
                "image_count": 0,
            },
        ),
        job={"job_id": "job-1", "space_id": "space-1", "created_by": "user-1"},
        payload={"source_document_id": "doc-1"},
        filename="note.txt",
        source_type="text",
        sha256="a" * 64,
        duration_ms=12,
    )

    frontmatter = artifacts.parsed_markdown.split("---", 2)[1]
    parsed = yaml.safe_load(frontmatter)

    for key in (
        "source_document_id",
        "filename",
        "source_type",
        "uploaded_by",
        "space_id",
        "sha256",
        "parsed_md_hash",
        "parsed_at",
        "extraction_tool",
        "extraction_version",
        "extraction_params",
        "extraction_duration_ms",
        "page_count",
        "char_count",
        "image_count",
        "preview_hash",
    ):
        assert key in parsed
    assert artifacts.preview_text == "Body text"
