## ADDED Requirements

### Requirement: Export page as Markdown

The system SHALL expose GET /api/internal/bridge/pages/{docmost_page_id}/export?format=markdown that returns the page content converted to Markdown with frontmatter metadata.

The response SHALL include:
- `page_id`: Docmost internal page ID
- `title`: Page title
- `content`: Full Markdown content with frontmatter
- `content_hash`: SHA256 hash of the content field (for optimistic locking)
- `space_id`: Docmost space the page belongs to
- `updated_at`: Last modification timestamp
- `updated_by`: User ID who last modified

#### Scenario: Successful page export
- **WHEN** Cherry API requests GET /api/internal/bridge/pages/{docmost_page_id}/export?format=markdown with valid auth
- **THEN** response is 200 with JSON containing page content as Markdown + content_hash + metadata

#### Scenario: Page not found
- **WHEN** Cherry API requests export for a non-existent page ID
- **THEN** response is 404 with error code BRIDGE_PAGE_NOT_FOUND

#### Scenario: Content hash stability
- **WHEN** the same page is exported twice without modification
- **THEN** both responses return identical content_hash values

### Requirement: Tiptap to Markdown conversion

The export controller SHALL convert Docmost's internal Tiptap JSON representation to GFM-compatible Markdown. The conversion SHALL preserve:
- Headings (h1-h6)
- Paragraphs and line breaks
- Bold, italic, strikethrough, code inline
- Code blocks with language annotation
- Ordered and unordered lists
- Tables
- Links and images
- Blockquotes
- Task lists (checkboxes)
- HTML comments (including `<!-- graphify:managed:* -->` block markers)

#### Scenario: Rich content preserved in export
- **WHEN** a page with tables, code blocks, and task lists is exported
- **THEN** the Markdown output contains GFM table syntax, fenced code blocks with language, and `- [ ]`/`- [x]` task items

#### Scenario: Unsupported blocks fallback
- **WHEN** a page contains Tiptap blocks without Markdown equivalent (e.g., embeds)
- **THEN** the block is exported as an HTML comment `<!-- unsupported: block_type -->` to preserve round-trip fidelity

#### Scenario: Graphify block markers preserved in export (P2-E3)
- **WHEN** a page contains `<!-- graphify:managed:section_id -->` HTML comments in its Tiptap content
- **THEN** the Markdown export preserves these comments verbatim in their original positions

#### Scenario: Nested block markers preserved
- **WHEN** a page contains both `<!-- graphify:managed:start -->` and `<!-- graphify:managed:end -->` paired markers
- **THEN** both markers appear in the exported Markdown with correct relative ordering
