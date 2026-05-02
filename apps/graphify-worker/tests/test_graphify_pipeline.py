from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from src import graphify_pipeline


def test_read_files_concatenates_with_headers(tmp_path: Path) -> None:
    (tmp_path / "a.md").write_text("# Hello", encoding="utf-8")
    (tmp_path / "b.md").write_text("# World", encoding="utf-8")
    result = graphify_pipeline._read_files([tmp_path / "a.md", tmp_path / "b.md"])
    assert "--- FILE: a.md ---" in result
    assert "--- FILE: b.md ---" in result
    assert "# Hello" in result
    assert "# World" in result


def test_chunk_contents_single_small_chunk() -> None:
    text = "--- FILE: a.md ---\nshort content"
    chunks = graphify_pipeline._chunk_contents(text, max_chars=10000)
    assert len(chunks) == 1
    assert chunks[0] == text


def test_chunk_contents_splits_large_input() -> None:
    files = [f"--- FILE: f{i}.md ---\n{'x' * 100}" for i in range(10)]
    text = "\n\n".join(files)
    chunks = graphify_pipeline._chunk_contents(text, max_chars=500)
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk) <= 600  # some tolerance for split boundaries


def test_make_id_normalizes() -> None:
    assert graphify_pipeline._make_id("Auth Service") == "auth_service"
    assert graphify_pipeline._make_id("JWT/Token-Validator") == "jwt_token_validator"
    assert graphify_pipeline._make_id("  spaces  ") == "spaces"


@pytest.mark.asyncio
async def test_llm_extract_deduplicates_nodes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    call_count = 0

    async def fake_call_llm(prompt: str) -> tuple[dict[str, Any], dict[str, int]]:
        nonlocal call_count
        call_count += 1
        return {
            "nodes": [
                {
                    "id": "auth_svc",
                    "label": "Auth Service",
                    "file_type": "document",
                    "source_file": "a.md",
                },
                {
                    "id": "token_svc",
                    "label": "Token Service",
                    "file_type": "document",
                    "source_file": "a.md",
                },
            ],
            "edges": [
                {
                    "source": "auth_svc",
                    "target": "token_svc",
                    "relation": "uses",
                    "confidence": "EXTRACTED",
                    "confidence_score": 1.0,
                },
            ],
            "hyperedges": [],
        }, {"prompt_tokens": 100, "completion_tokens": 50}

    monkeypatch.setattr(graphify_pipeline, "_call_llm", fake_call_llm)

    (tmp_path / "a.md").write_text("# Auth design\nJWT tokens used", encoding="utf-8")
    result = await graphify_pipeline._llm_extract([tmp_path / "a.md"])

    assert len(result["nodes"]) == 2
    assert result["nodes"][0]["id"] == "auth_svc"
    assert len(result["edges"]) == 1
    assert result["input_tokens"] == 100
    assert result["output_tokens"] == 50
    assert call_count == 1


@pytest.mark.asyncio
async def test_llm_extract_handles_chunk_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    call_count = 0

    async def fake_call_llm(prompt: str) -> tuple[dict[str, Any], dict[str, int]]:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise ConnectionError("API down")
        return {"nodes": [{"id": "b", "label": "B"}], "edges": []}, {
            "prompt_tokens": 0,
            "completion_tokens": 0,
        }

    monkeypatch.setattr(graphify_pipeline, "_call_llm", fake_call_llm)
    monkeypatch.setattr(graphify_pipeline, "_EXTRACTION_MAX_CHARS", 50)

    (tmp_path / "a.md").write_text("x" * 40, encoding="utf-8")
    (tmp_path / "b.md").write_text("y" * 40, encoding="utf-8")
    result = await graphify_pipeline._llm_extract(
        [tmp_path / "a.md", tmp_path / "b.md"]
    )

    assert call_count == 2
    assert len(result["nodes"]) == 1
    assert result["nodes"][0]["id"] == "b"
