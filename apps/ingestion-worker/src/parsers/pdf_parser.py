from __future__ import annotations

from pathlib import Path
from typing import Any

import pdfplumber

from .base_parser import BaseParser, ParseResult
from .utils import compact_blank_lines, markdown_table, package_version


class PdfParser(BaseParser):
    source_type = "pdf"
    extraction_tool = "pdfplumber"
    extraction_version = package_version("pdfplumber")

    def __init__(
        self, *, ocr_enabled: bool = True, ocr_lang: str = "chi_sim+eng"
    ) -> None:
        self.ocr_enabled = ocr_enabled
        self.ocr_lang = ocr_lang

    def parse(self, file_path: Path) -> ParseResult:
        sections: list[str] = []
        image_count = 0
        ocr_used = False
        ocr_available = self._ocr_available()

        with pdfplumber.open(file_path) as pdf:
            for page_index, page in enumerate(pdf.pages, start=1):
                sections.append(f"## Page {page_index}")
                page_text = page.extract_text() or ""
                image_count += len(getattr(page, "images", []) or [])

                if not page_text.strip() and self.ocr_enabled:
                    page_text = self._ocr_page(page)
                    ocr_used = ocr_used or bool(page_text.strip())

                if page_text.strip():
                    sections.append(page_text.strip())

                for table in page.extract_tables() or []:
                    table_markdown = markdown_table(table)
                    if table_markdown:
                        sections.append(table_markdown)

            content = compact_blank_lines("\n\n".join(sections))
            return ParseResult(
                content=content,
                metadata={
                    "source_type": self.source_type,
                    "extraction_tool": self.extraction_tool,
                    "extraction_version": self.extraction_version,
                    "extraction_params": {
                        "ocr_enabled": self.ocr_enabled,
                        "ocr_lang": self.ocr_lang,
                        "ocr_available": ocr_available,
                        "table_strategy": "pdfplumber.extract_tables",
                    },
                    "page_count": len(pdf.pages),
                    "char_count": len(content),
                    "image_count": image_count,
                    "ocr_used": ocr_used,
                },
            )

    def _ocr_available(self) -> bool:
        try:
            import pytesseract  # noqa: F401
        except Exception:
            return False
        return True

    def _ocr_page(self, page: Any) -> str:
        try:
            import pytesseract

            image = page.to_image(resolution=150).original
            return pytesseract.image_to_string(image, lang=self.ocr_lang) or ""
        except Exception:
            return ""
