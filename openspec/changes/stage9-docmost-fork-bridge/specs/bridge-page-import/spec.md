## ADDED Requirements

### Requirement: Import page from Markdown

The system SHALL expose PUT /api/internal/bridge/pages/{docmost_page_id}/import that accepts Markdown content and updates the Docmost page's Tiptap document.

Request body SHALL include:
- `content`: Markdown string (with optional frontmatter)
- `overwrite_policy`: One of `create_only` | `update` | `force`
- `expected_hash`: (optional) content_hash from previous export for optimistic locking
- `source`: Origin identifier (e.g., "graphify", "wiki-sync")

#### Scenario: Create new page (create_only)
- **WHEN** Cherry API sends PUT with overwrite_policy=create_only and page does not exist
- **THEN** a new Docmost page is created with the provided Markdown converted to Tiptap, response is 201

#### Scenario: Create_only fails for existing page
- **WHEN** Cherry API sends PUT with overwrite_policy=create_only and page already exists
- **THEN** response is 409 with error code BRIDGE_PAGE_EXISTS

#### Scenario: Update existing page (update)
- **WHEN** Cherry API sends PUT with overwrite_policy=update and matching expected_hash
- **THEN** page content is updated, response is 200 with new content_hash

#### Scenario: Optimistic lock conflict (update)
- **WHEN** Cherry API sends PUT with overwrite_policy=update and expected_hash does not match current
- **THEN** response is 409 with error code BRIDGE_HASH_CONFLICT and current content_hash in response

#### Scenario: Force overwrite (force)
- **WHEN** Cherry API sends PUT with overwrite_policy=force
- **THEN** page content is overwritten regardless of current state, response is 200

#### Scenario: Invalid page ID
- **WHEN** Cherry API sends PUT to a non-existent page ID with overwrite_policy=update
- **THEN** response is 404 with error code BRIDGE_PAGE_NOT_FOUND

### Requirement: Markdown to Tiptap conversion

The import controller SHALL convert GFM Markdown to Docmost's Tiptap JSON document format. The conversion SHALL handle the same element set as the export (headings, lists, tables, code blocks, links, images, task lists, blockquotes, HTML comments).

#### Scenario: Markdown imported preserves structure
- **WHEN** Markdown with headings, tables, and code blocks is imported
- **THEN** the Tiptap document contains corresponding nodes with correct attributes

#### Scenario: Frontmatter stripped from Tiptap content
- **WHEN** Markdown with YAML frontmatter (--- delimited) is imported
- **THEN** frontmatter is parsed for metadata but not rendered in the Tiptap document body

#### Scenario: Graphify block markers preserved in import (P2-E3)
- **WHEN** Markdown containing `<!-- graphify:managed:section_id -->` comments is imported
- **THEN** the Tiptap document preserves these as HTML comment nodes in their original positions

#### Scenario: Round-trip fidelity for block markers
- **WHEN** a page with graphify:managed markers is exported then immediately re-imported
- **THEN** the markers remain in identical positions and the content_hash after re-export matches the original
