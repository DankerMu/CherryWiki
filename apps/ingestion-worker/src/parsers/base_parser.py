from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class ParseResult:
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseParser(ABC):
    source_type = "document"
    extraction_tool = "unknown"
    extraction_version = "unknown"

    @abstractmethod
    def parse(self, file_path: Path) -> ParseResult:
        raise NotImplementedError
