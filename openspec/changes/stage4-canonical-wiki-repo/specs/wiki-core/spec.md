## ADDED Requirements

### Requirement: Frontmatter parser
The `wiki-core` package SHALL export a `parseFrontmatter(markdown: string)` function that extracts YAML frontmatter delimited by `---` from a markdown string and returns `{ frontmatter: WikiFrontmatter, content: string }`.

#### Scenario: Parse markdown with valid frontmatter
- **WHEN** input is `"---\ntitle: Hello\npage_id: p1\npage_type: community\n---\n# Content"`
- **THEN** result SHALL be `{ frontmatter: { title: "Hello", page_id: "p1", page_type: "community", ... }, content: "# Content" }`

#### Scenario: Parse markdown without frontmatter
- **WHEN** input is `"# Just content"`
- **THEN** result SHALL be `{ frontmatter: {}, content: "# Just content" }`

#### Scenario: Parse markdown with empty frontmatter
- **WHEN** input is `"---\n---\n# Content"`
- **THEN** result SHALL be `{ frontmatter: {}, content: "# Content" }`

### Requirement: Standard frontmatter fields (Doc 21 §9.5)
The `wiki-core` package SHALL define a `WikiFrontmatter` TypeScript type with the following fields matching Doc 21 §9.5:
- `page_id`: string (required)
- `title`: string (required)
- `space_id`: string (required)
- `page_type`: 'community' | 'god_node' | 'generated_article' | 'index' (required)
- `status`: 'draft' | 'published' | 'archived' (required, default 'draft')
- `curation_status`: 'auto_generated' | 'human_curated' | 'mixed' (required)
- `source`: 'graphify' | 'human' | 'import' | 'rollback' (required)
- `graphify_run_id`: string (optional)
- `graphify_schema_version`: string (optional)
- `managed_by`: 'graphify' | 'human_curated' (required)
- `source_document_ids`: string[] (required, default [])
- `graph_node_ids`: string[] (required, default [])
- `version`: number (required)
- `acl_hash`: string (required, default '')
- `created_by`: string (required)
- `created_at`: ISO 8601 string (required)
- `updated_at`: ISO 8601 string (required)

#### Scenario: Generate frontmatter for new Graphify page
- **WHEN** a page is created from Graphify output
- **THEN** frontmatter SHALL contain all required fields with `source: 'graphify'`, `managed_by: 'graphify'`, `curation_status: 'auto_generated'`

#### Scenario: Frontmatter round-trip
- **WHEN** frontmatter is generated then parsed back
- **THEN** all field values SHALL be preserved exactly

### Requirement: Frontmatter generator
The `wiki-core` package SHALL export a `generateFrontmatter(frontmatter: WikiFrontmatter, content: string)` function that prepends YAML frontmatter to markdown content.

#### Scenario: Generate markdown with frontmatter
- **WHEN** frontmatter contains all required fields and content is `"# Content"`
- **THEN** result SHALL be valid markdown with `---` delimited YAML frontmatter followed by a blank line and content

### Requirement: Page slug generator (Doc 21 §9.3)
The `wiki-core` package SHALL export a `generateSlug(label: string, existingSlugs?: string[])` function that replicates Graphify's `_safe_filename()` algorithm: replace `/` with `-`, spaces with `_`, `:` with `-`. For duplicate slugs, append `_2`, `_3` etc. (matching Graphify's `_unique_slug()`).

#### Scenario: Basic slug generation
- **WHEN** label is `"Hello World"`
- **THEN** slug SHALL be `"Hello_World"` (spaces → underscores)

#### Scenario: Special character replacement
- **WHEN** label is `"auth/token:service"`
- **THEN** slug SHALL be `"auth-token-service"` (/ → -, : → -)

#### Scenario: Slug deduplication
- **WHEN** label is `"Hello World"` and existingSlugs contains `"Hello_World"`
- **THEN** slug SHALL be `"Hello_World_2"`

#### Scenario: Chinese characters preserved
- **WHEN** label is `"数据库设计"`
- **THEN** slug SHALL be `"数据库设计"` (non-ASCII characters are preserved, only /, space, : are replaced)

### Requirement: Page ID generator (Doc 21 §9.4)
The `wiki-core` package SHALL export a `generatePageId(spaceId: string, pageType: string, stableKey: string)` function that produces page IDs following the pattern `{space_id}.{type_prefix}.{stable_key}`.

Type prefix mapping:
- `index` → `index` (stable_key: `root`)
- `community` → `community` (stable_key: `community_{cid}`)
- `god_node` → `god-node` (stable_key: first 12 chars of node stable_key)
- `generated_article` → `page` (stable_key: SHA256(slug)[:12])

#### Scenario: Community page ID
- **WHEN** spaceId is `"rd-platform"`, pageType is `"community"`, stableKey is `"community_1"`
- **THEN** page_id SHALL be `"rd-platform.community.community_1"`

#### Scenario: Index page ID
- **WHEN** spaceId is `"rd-platform"`, pageType is `"index"`, stableKey is `"root"`
- **THEN** page_id SHALL be `"rd-platform.index.root"`

### Requirement: Publish state machine
The `wiki-core` package SHALL export a `PublishStateMachine` class that enforces valid status transitions for wiki page versions. Status values: `draft`, `published`, `archived` (matching openapi.yaml WikiPage.status enum).

#### Scenario: Draft to published
- **WHEN** a version with status `draft` is published
- **THEN** transition SHALL succeed, status becomes `published`

#### Scenario: Publish already published version
- **WHEN** a version with status `published` is published again
- **THEN** transition SHALL be rejected with a `VERSION_ALREADY_PUBLISHED` error

#### Scenario: Archive a published page
- **WHEN** a page with status `published` is archived
- **THEN** page status becomes `archived`, current_version_id is preserved

#### Scenario: Rollback creates new version
- **WHEN** rollback is requested targeting version N
- **THEN** a new version N+1 SHALL be created with content copied from version N, source='rollback', and status='published'

### Requirement: Section extractor with anchor generation (Doc 21 §9.6)
The `wiki-core` package SHALL export a `extractSections(markdown: string, pageId: string)` function that parses headings (h2 and h3 only, per Doc 21 §9.6) from markdown content and returns an ordered array of section descriptors. Each section SHALL have a `section_id` following the pattern `{page_id}#heading-{slugify(heading_text)}`.

#### Scenario: Extract h2 and h3 headings
- **WHEN** markdown contains `"# Title\n\n## Section A\n\nText\n\n### Subsection\n\n## Section B"`
- **THEN** result SHALL contain 3 sections (h2 "Section A", h3 "Subsection", h2 "Section B") with correct levels, section_index, start_offset/end_offset, and section_ids like `"{pageId}#heading-section-a"`

#### Scenario: h1 headings are excluded
- **WHEN** markdown contains only `"# Title"` (h1)
- **THEN** result SHALL be an empty array (h1 is page title, not a section)

#### Scenario: Empty markdown
- **WHEN** markdown is empty string
- **THEN** result SHALL be an empty array

### Requirement: Version service
The `wiki-core` package SHALL export version management functions: `createVersion(pageId, content, source, createdBy)` that auto-increments version_no, and `getLatestVersionNo(pageId)` that returns the highest version_no for a page.

#### Scenario: First version of a new page
- **WHEN** createVersion is called for a page with no versions
- **THEN** version_no SHALL be 1

#### Scenario: Subsequent version
- **WHEN** createVersion is called for a page that already has versions 1 and 2
- **THEN** version_no SHALL be 3
