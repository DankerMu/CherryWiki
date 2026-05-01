from __future__ import annotations

from pathlib import Path

from PIL import Image

from .base_parser import BaseParser, ParseResult
from .utils import compact_blank_lines, package_version


class ImageParser(BaseParser):
    source_type = "image"
    extraction_tool = "pillow"
    extraction_version = package_version("Pillow")

    def __init__(self, *, ocr_lang: str = "chi_sim+eng") -> None:
        self.ocr_lang = ocr_lang

    def parse(self, file_path: Path) -> ParseResult:
        with Image.open(file_path) as image:
            width, height = image.size
            image_format = image.format or file_path.suffix.removeprefix(".").upper()
            ocr_text = self._ocr_image(image)

        sections = ["# Image OCR Result"]
        if ocr_text.strip():
            sections.append(ocr_text.strip())
        else:
            sections.append("No text content extracted via OCR")

        sections.extend(
            [
                "## Image Metadata",
                f"- Format: {image_format}",
                f"- Dimensions: {width}x{height}",
            ]
        )
        content = compact_blank_lines("\n\n".join(sections))
        return ParseResult(
            content=content,
            metadata={
                "source_type": self.source_type,
                "extraction_tool": self.extraction_tool,
                "extraction_version": self.extraction_version,
                "extraction_params": {
                    "ocr_enabled": self._ocr_available(),
                    "ocr_lang": self.ocr_lang,
                    "image_format": image_format,
                    "width": width,
                    "height": height,
                },
                "page_count": 1,
                "char_count": len(content),
                "image_count": 1,
                "ocr_used": bool(ocr_text.strip()),
            },
        )

    def _ocr_available(self) -> bool:
        try:
            import pytesseract  # noqa: F401
        except Exception:
            return False
        return True

    def _ocr_image(self, image: Image.Image) -> str:
        try:
            import pytesseract

            return pytesseract.image_to_string(image, lang=self.ocr_lang) or ""
        except Exception:
            return ""
