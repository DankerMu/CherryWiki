from __future__ import annotations

from pathlib import Path


def generate_manifest(
    space_id: str,
    run_id: str,
    mode: str,
    input_files: list[Path],
    graphify_ref: str | None,
) -> dict[str, object]:
    return {
        "space_id": space_id,
        "run_id": run_id,
        "mode": mode,
        "input_files": [str(path) for path in input_files],
        "graphify_ref": graphify_ref,
    }
