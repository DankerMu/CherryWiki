## ADDED Requirements

### Requirement: PDF parsing
The system SHALL parse PDF files using pdfplumber to extract text content and tables. For scanned PDFs with no extractable text, the system SHALL fall back to pytesseract OCR. The extracted content SHALL be organized by page with page number annotations.

#### Scenario: Text-based PDF parsing
- **WHEN** ingestion-worker receives a text-based PDF file
- **THEN** it extracts text and tables using pdfplumber, producing a Markdown document with page-separated content

#### Scenario: Scanned PDF OCR fallback
- **WHEN** ingestion-worker receives a PDF with no extractable text (scanned document)
- **THEN** it falls back to pytesseract OCR, producing best-effort text extraction with an `ocr_used: true` metadata flag

#### Scenario: PDF with tables
- **WHEN** ingestion-worker encounters tables in a PDF
- **THEN** tables are converted to Markdown table format with column headers and row data preserved

### Requirement: Office document parsing
The system SHALL parse DOCX files using python-docx, PPTX files using python-pptx, and XLSX files using openpyxl. Each format SHALL produce structured Markdown output preserving the document's logical structure.

#### Scenario: DOCX parsing
- **WHEN** ingestion-worker receives a DOCX file
- **THEN** it extracts headings, paragraphs, tables, and lists into structured Markdown, preserving heading hierarchy

#### Scenario: PPTX parsing
- **WHEN** ingestion-worker receives a PPTX file
- **THEN** it extracts each slide's title and text content as separate sections, plus speaker notes as blockquotes

#### Scenario: XLSX parsing
- **WHEN** ingestion-worker receives an XLSX file with multiple sheets
- **THEN** each sheet is converted to a Markdown table section, with the sheet name as section heading

### Requirement: Text and Markdown file handling
The system SHALL read MD, MDX, TXT, and RST files directly. MD/MDX files SHALL have their existing frontmatter preserved and augmented with parsing metadata. RST files SHALL be converted to Markdown using pandoc (if available) or basic regex conversion.

#### Scenario: Markdown file passthrough
- **WHEN** ingestion-worker receives a .md file
- **THEN** the content is preserved as-is with parsing metadata added to frontmatter

#### Scenario: RST to Markdown conversion
- **WHEN** ingestion-worker receives a .rst file
- **THEN** it is converted to Markdown format with heading structure preserved

### Requirement: Image OCR processing
The system SHALL process image files (PNG, JPG, JPEG, WEBP) using pytesseract OCR to extract visible text. The output SHALL include the extracted text and image metadata (dimensions, format).

#### Scenario: Image with text
- **WHEN** ingestion-worker receives a PNG screenshot containing text
- **THEN** OCR extracts the visible text into a Markdown document with an "Image OCR Result" heading

#### Scenario: Image with no text
- **WHEN** ingestion-worker receives a photo with no readable text
- **THEN** the output contains image metadata only with a note "No text content extracted via OCR"

### Requirement: ZIP batch processing
The system SHALL process ZIP files by extracting each file and parsing them individually. Each file within the ZIP SHALL produce its own parsed.md. A single file's parsing failure SHALL NOT block the processing of remaining files in the ZIP.

#### Scenario: ZIP with mixed file types
- **WHEN** ingestion-worker receives a ZIP containing 3 PDFs and 2 DOCXs
- **THEN** each file is parsed independently, producing 5 separate parsed.md outputs

#### Scenario: Partial failure in ZIP
- **WHEN** one file in a ZIP fails parsing but others succeed
- **THEN** successful files have status=parsed, the failed file has status=parse_failed, and the overall ZIP job reports partial completion with error details for the failed file

### Requirement: Parsing timeout
The system SHALL enforce a 300-second timeout for parsing a single file. If parsing exceeds this timeout, the process SHALL be terminated and the file marked as parse_failed with error_type="timeout".

#### Scenario: File exceeds parsing timeout
- **WHEN** a complex PDF takes longer than 300 seconds to parse
- **THEN** the parsing is aborted, source_document status is set to parse_failed, and error_json includes error_type="timeout" and duration_ms
