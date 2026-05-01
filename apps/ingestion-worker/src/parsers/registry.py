from __future__ import annotations

from pathlib import Path

from .base_parser import BaseParser
from .docx_parser import DocxParser
from .image_parser import ImageParser
from .pdf_parser import PdfParser
from .pptx_parser import PptxParser
from .text_parser import TextParser
from .xlsx_parser import XlsxParser


ZIP_MIME_TYPES = {"application/zip", "application/x-zip-compressed", "multipart/x-zip"}


class ParserRegistry:
    def __init__(self) -> None:
        self._pdf = PdfParser()
        self._docx = DocxParser()
        self._pptx = PptxParser()
        self._xlsx = XlsxParser()
        self._text = TextParser()
        self._image = ImageParser()

    def parser_for(self, *, mime_type: str | None, file_path: Path | None = None, filename: str | None = None) -> BaseParser:
        normalized_mime = (mime_type or "").split(";", 1)[0].strip().lower()
        suffix = self._suffix(file_path=file_path, filename=filename)

        if normalized_mime == "application/pdf" or suffix == ".pdf":
            return self._pdf
        if normalized_mime in {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        } or suffix == ".docx":
            return self._docx
        if normalized_mime in {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        } or suffix == ".pptx":
            return self._pptx
        if normalized_mime in {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        } or suffix == ".xlsx":
            return self._xlsx
        if normalized_mime.startswith("image/") or suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}:
            return self._image
        if normalized_mime in {
            "text/plain",
            "text/markdown",
            "text/x-markdown",
            "text/x-rst",
            "application/markdown",
            "application/octet-stream",
            "",
        } or suffix in {".md", ".mdx", ".txt", ".rst"}:
            return self._text

        raise ValueError(f"Unsupported MIME type or extension: {mime_type or suffix or 'unknown'}")

    def is_zip(self, *, mime_type: str | None, file_path: Path | None = None, filename: str | None = None) -> bool:
        normalized_mime = (mime_type or "").split(";", 1)[0].strip().lower()
        return normalized_mime in ZIP_MIME_TYPES or self._suffix(file_path=file_path, filename=filename) == ".zip"

    def _suffix(self, *, file_path: Path | None, filename: str | None) -> str:
        if file_path is not None and file_path.suffix:
            return file_path.suffix.lower()
        if filename:
            return Path(filename).suffix.lower()
        return ""
