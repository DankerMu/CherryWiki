from __future__ import annotations

from collections.abc import Iterable, Sequence
from importlib import metadata
from typing import Any


def package_version(package_name: str) -> str:
    try:
        return metadata.version(package_name)
    except metadata.PackageNotFoundError:
        return "unknown"


def markdown_table(rows: Iterable[Sequence[Any]]) -> str:
    normalized = [_normalize_row(row) for row in rows]
    normalized = [row for row in normalized if any(cell != "" for cell in row)]
    if not normalized:
        return ""

    width = max(len(row) for row in normalized)
    padded = [row + [""] * (width - len(row)) for row in normalized]
    header = padded[0]
    body = padded[1:] or [[""] * width]

    lines = [
        "| " + " | ".join(_escape_cell(cell) for cell in header) + " |",
        "| " + " | ".join("---" for _ in range(width)) + " |",
    ]
    lines.extend("| " + " | ".join(_escape_cell(cell) for cell in row) + " |" for row in body)
    return "\n".join(lines)


def compact_blank_lines(text: str) -> str:
    lines: list[str] = []
    previous_blank = False
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.rstrip()
        is_blank = line == ""
        if is_blank and previous_blank:
            continue
        lines.append(line)
        previous_blank = is_blank
    return "\n".join(lines).strip() + "\n"


def _normalize_row(row: Sequence[Any]) -> list[str]:
    return ["" if value is None else str(value).strip() for value in row]


def _escape_cell(value: str) -> str:
    return value.replace("\n", " ").replace("|", "\\|")
