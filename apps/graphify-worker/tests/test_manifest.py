from __future__ import annotations

from pathlib import Path

from src.manifest import generate_manifest


def test_generate_manifest_uses_stringified_input_paths() -> None:
    manifest = generate_manifest(
        "space-1",
        "run-1",
        "full",
        [Path("/work/input/a.md"), Path("/work/input/b.md")],
        "graphify-v1",
    )

    assert manifest == {
        "space_id": "space-1",
        "run_id": "run-1",
        "mode": "full",
        "input_files": ["/work/input/a.md", "/work/input/b.md"],
        "graphify_ref": "graphify-v1",
    }
