from __future__ import annotations

from pathlib import Path

from .base_parser import BaseParser, ParseResult
from .utils import compact_blank_lines


class TextParser(BaseParser):
    source_type = "text"
    extraction_tool = "passthrough"
    extraction_version = "1"

    def parse(self, file_path: Path) -> ParseResult:
        content = self._read_text(file_path)
        if file_path.suffix.lower() == ".rst":
            content = self._rst_to_markdown(content)
        normalized = content.replace("\r\n", "\n").replace("\r", "\n")
        if normalized and not normalized.endswith("\n"):
            normalized += "\n"

        return ParseResult(
            content=normalized,
            metadata={
                "source_type": "rst" if file_path.suffix.lower() == ".rst" else self.source_type,
                "extraction_tool": self.extraction_tool,
                "extraction_version": self.extraction_version,
                "extraction_params": {"encoding": "auto", "rst_conversion": "basic" if file_path.suffix.lower() == ".rst" else None},
                "page_count": 1,
                "char_count": len(normalized),
                "image_count": 0,
            },
        )

    def _read_text(self, file_path: Path) -> str:
        for encoding in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                return file_path.read_text(encoding=encoding)
            except UnicodeDecodeError:
                continue
        return file_path.read_text(encoding="utf-8", errors="replace")

    def _rst_to_markdown(self, content: str) -> str:
        lines = content.splitlines()
        output: list[str] = []
        index = 0
        while index < len(lines):
            line = lines[index]
            next_line = lines[index + 1] if index + 1 < len(lines) else ""
            if line.strip() and next_line and set(next_line.strip()) in ({"="}, {"-"}, {"~"}):
                marker = next_line.strip()[0]
                level = {"=": "#", "-": "##", "~": "###"}.get(marker, "##")
                output.append(f"{level} {line.strip()}")
                index += 2
                continue
            output.append(line)
            index += 1
        return compact_blank_lines("\n".join(output))
