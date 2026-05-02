"""Graphify pipeline: LLM semantic extraction → graph build → cluster → wiki export.

Replaces the old subprocess CLI call. Uses graphify Python API for all
deterministic steps and an OpenAI-compatible LLM for semantic extraction.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MODEL_API_BASE_URL = os.environ.get("MODEL_API_BASE_URL", "")
MODEL_API_KEY = os.environ.get("MODEL_API_KEY", "")
DEFAULT_CHAT_MODEL = os.environ.get("DEFAULT_CHAT_MODEL", "deepseek-v4-flash")
_EXTRACTION_MAX_CHARS = 60_000

_EXTRACTION_PROMPT = """\
You are a graphify extraction agent. Read the documents below and extract a knowledge graph.
Output ONLY valid JSON matching the schema — no explanation, no markdown fences.

Rules:
- EXTRACTED: relationship explicit in source (import, call, citation, "see §X")
- INFERRED: reasonable inference (shared concept, implied dependency)
- AMBIGUOUS: uncertain — flag for review
- confidence_score: EXTRACTED=1.0, INFERRED=0.6-0.9, AMBIGUOUS=0.1-0.3
- Node ID: lowercase, only [a-z0-9_], format: filestem_entity
- For docs: extract named concepts, entities, decisions, components

Documents:
{file_contents}

Output exactly this JSON schema (no other text):
{{"nodes":[{{"id":"snake_case_id","label":"Human Name","file_type":"document","source_file":"path"}}],"edges":[{{"source":"id","target":"id","relation":"references|implements|uses|cites|conceptually_related_to","confidence":"EXTRACTED|INFERRED|AMBIGUOUS","confidence_score":1.0,"source_file":"path"}}],"hyperedges":[]}}"""


def _make_id(label: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", label)
    return cleaned.strip("_").lower()


async def execute(input_dir: Path, output_dir: Path, mode: str) -> None:
    """Run the full graphify pipeline and write results to output_dir."""
    input_files = sorted(f for f in input_dir.iterdir() if f.is_file())
    if not input_files:
        raise RuntimeError(json.dumps({"reason": "no_input_files"}))

    logger.info("pipeline start", extra={"file_count": len(input_files), "mode": mode})

    extraction = await _llm_extract(input_files, deep=mode == "deep")

    from graphify.build import build_from_json
    from graphify.cluster import cluster, score_all
    from graphify.analyze import god_nodes, surprising_connections, suggest_questions
    from graphify.export import to_json, to_html
    from graphify.wiki import to_wiki
    from graphify.report import generate as generate_report

    G = build_from_json(extraction, directed=False)
    logger.info(
        "graph built",
        extra={"nodes": G.number_of_nodes(), "edges": G.number_of_edges()},
    )

    communities = cluster(G)
    cohesion = score_all(G, communities)
    labels = {cid: f"Community {cid}" for cid in communities}
    gods = god_nodes(G)
    surprises = surprising_connections(G, communities)
    questions = suggest_questions(G, communities, labels)

    to_json(G, communities, str(output_dir / "graph.json"), force=True)

    if G.number_of_nodes() <= 5000:
        try:
            to_html(
                G,
                communities,
                str(output_dir / "graph.html"),
                community_labels=labels,
            )
        except Exception:
            logger.warning("graph.html generation failed", exc_info=True)

    wiki_count = to_wiki(
        G,
        communities,
        str(output_dir / "wiki"),
        community_labels=labels,
        cohesion=cohesion,
        god_nodes_data=gods,
    )
    logger.info("wiki generated", extra={"page_count": wiki_count})

    tokens = {
        "input": extraction.get("input_tokens", 0),
        "output": extraction.get("output_tokens", 0),
    }
    detection_result = {
        "total_files": len(input_files),
        "total_words": sum(
            len(f.read_text(encoding="utf-8").split())
            for f in input_files
            if f.exists()
        ),
    }
    report = generate_report(
        G,
        communities,
        cohesion,
        labels,
        gods,
        surprises,
        detection_result,
        tokens,
        str(input_dir),
        suggested_questions=questions,
    )
    (output_dir / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")

    logger.info(
        "pipeline complete",
        extra={
            "nodes": G.number_of_nodes(),
            "edges": G.number_of_edges(),
            "communities": len(communities),
            "wiki_pages": wiki_count,
        },
    )


async def _llm_extract(files: list[Path], *, deep: bool = False) -> dict[str, Any]:
    file_contents = _read_files(files)
    chunks = _chunk_contents(file_contents, max_chars=_EXTRACTION_MAX_CHARS)

    all_nodes: list[dict] = []
    all_edges: list[dict] = []
    all_hyperedges: list[dict] = []
    total_input = 0
    total_output = 0

    for i, chunk in enumerate(chunks, 1):
        logger.info("extracting chunk", extra={"chunk": i, "total": len(chunks)})
        prompt = _EXTRACTION_PROMPT.format(file_contents=chunk)
        if deep:
            prompt += (
                "\n\nDEEP MODE: be aggressive with INFERRED edges — indirect deps, "
                "shared assumptions, latent couplings. Mark uncertain ones AMBIGUOUS."
            )

        try:
            result, usage = await _call_llm(prompt)
            total_input += usage.get("prompt_tokens", 0)
            total_output += usage.get("completion_tokens", 0)
            all_nodes.extend(result.get("nodes", []))
            all_edges.extend(result.get("edges", []))
            all_hyperedges.extend(result.get("hyperedges", []))
        except Exception:
            logger.warning("chunk %d extraction failed", i, exc_info=True)

    seen: set[str] = set()
    deduped: list[dict] = []
    for n in all_nodes:
        nid = n.get("id", "")
        if nid and nid not in seen:
            seen.add(nid)
            deduped.append(n)

    return {
        "nodes": deduped,
        "edges": all_edges,
        "hyperedges": all_hyperedges,
        "input_tokens": total_input,
        "output_tokens": total_output,
    }


def _read_files(files: list[Path]) -> str:
    parts: list[str] = []
    for f in files:
        try:
            text = f.read_text(encoding="utf-8")
            parts.append(f"--- FILE: {f.name} ---\n{text}")
        except Exception:
            logger.warning("failed to read %s", f.name)
    return "\n\n".join(parts)


def _chunk_contents(text: str, *, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    sections = text.split("--- FILE: ")
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for section in sections:
        if not section.strip():
            continue
        piece = f"--- FILE: {section}"
        if current_len + len(piece) > max_chars and current:
            chunks.append("\n\n".join(current))
            current = []
            current_len = 0
        current.append(piece)
        current_len += len(piece)
    if current:
        chunks.append("\n\n".join(current))
    return chunks or [text]


async def _call_llm(prompt: str) -> tuple[dict[str, Any], dict[str, int]]:
    import httpx

    url = f"{MODEL_API_BASE_URL.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {MODEL_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "model": DEFAULT_CHAT_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }

    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(url, json=body, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    content = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})

    parsed = json.loads(content)
    if not isinstance(parsed, dict) or "nodes" not in parsed:
        raise ValueError("LLM response missing 'nodes' key")

    return parsed, usage
