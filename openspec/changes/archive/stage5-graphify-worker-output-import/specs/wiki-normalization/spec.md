## ADDED Requirements

### Requirement: Page type identification (Doc 21 §9.3)
The `packages/wiki-core` SHALL export a `identifyPageType(filename: string, communityLabels: string[], godNodeLabels: string[])` function that returns the page type. Labels are compared after applying `safeFilename()` to each label.

#### Scenario: Index page
- **WHEN** filename is "index.md"
- **THEN** type SHALL be "index"

#### Scenario: Community page
- **WHEN** filename is "Auth_System.md" and communityLabels contains "Auth System" (safeFilename → "Auth_System")
- **THEN** type SHALL be "community"

#### Scenario: God node page
- **WHEN** filename is "JWT_Authentication.md" and godNodeLabels contains "JWT Authentication"
- **THEN** type SHALL be "god_node"

#### Scenario: Unmatched page
- **WHEN** filename does not match any community or god node label
- **THEN** type SHALL be "generated_article"

### Requirement: _safe_filename replication (Doc 21 §9.3)
The `wiki-core` SHALL export a `safeFilename(label: string)` function matching Graphify v0.5.3 `wiki.py:9` exactly: `label.replace("/", "-").replace(" ", "_").replace(":", "-")`.

#### Scenario: Label with spaces and slashes
- **WHEN** label is "Auth/SSO Service"
- **THEN** result SHALL be "Auth-SSO_Service"

#### Scenario: Label with colons
- **WHEN** label is "Module: Core"
- **THEN** result SHALL be "Module-_Core"

### Requirement: _unique_slug dedup (Doc 21 §9.3)
The `wiki-core` SHALL export a `uniqueSlug(slug: string, existingSlugs: Set<string>)` function that appends `_2`, `_3` etc. for collisions, matching Graphify `_unique_slug()`.

#### Scenario: No collision
- **WHEN** slug is "auth" and existingSlugs is empty
- **THEN** result SHALL be "auth"

#### Scenario: Collision
- **WHEN** slug is "auth" and existingSlugs contains "auth"
- **THEN** result SHALL be "auth_2"

### Requirement: page_id generation (Doc 21 §9.4)
The `wiki-core` SHALL generate page_id per Doc 21 §9.4 exact rules:

| Page type | Formula | Example |
|---|---|---|
| index | `{space_id}.index.root` | `rd-platform.index.root` |
| community | `{space_id}.community.{community_key}` | `rd-platform.community.community_1` |
| god_node | `{space_id}.god-node.{stable_key[:12]}` | `rd-platform.god-node.a1b2c3d4e5f6` |
| generated_article | `{space_id}.page.{SHA256(slug)[:12]}` | `rd-platform.page.a1b2c3d4e5f6` |

#### Scenario: Community page_id
- **WHEN** page type is "community" and community_key is "community_1"
- **THEN** page_id SHALL be "{space_id}.community.community_1"

#### Scenario: God node page_id uses stable_key
- **WHEN** page type is "god_node" and graph-core stable_key is "a1b2c3d4e5f6g7h8"
- **THEN** page_id SHALL be "{space_id}.god-node.a1b2c3d4e5f6" (first 12 chars)

### Requirement: Wiki normalization entry point
The `packages/wiki-core` SHALL export an `importGraphifyWiki(params: NormalizationParams)` function that orchestrates the full wiki normalization pipeline per Doc 21 §9.9.

Parameters:
```typescript
interface NormalizationParams {
  tenantId: string;
  spaceId: string;
  runId: string;
  graphOutput: GraphOutput;
  wikiFiles: Map<string, string>;    // filename → markdown content
  reportMarkdown: string;
  existingPages: WikiPageInfo[];
  existingBlockMetadata: Map<string, BlockMetadata[]>;
  db: DrizzleClient;
}
```

Returns:
```typescript
interface NormalizationResult {
  pagesCreated: WikiPageImport[];
  pagesUpdated: WikiPageImport[];
  pagesUnchanged: string[];
  proposalsCreated: ProposalInfo[];
  indexUpdateManifest: IndexUpdateManifest;
  gitCommits: GitCommitInfo[];
}
```

### Requirement: Frontmatter auto-generation (Doc 21 §9.5)
For each wiki file, normalization SHALL generate frontmatter with ALL 17 fields from Doc 21 §9.5: page_id, title, space_id, page_type, status, curation_status, source, graphify_run_id, graphify_schema_version, managed_by, source_document_ids, graph_node_ids, version, acl_hash, created_by, created_at, updated_at.

`source_document_ids` SHALL be derived from the `graphify_input_manifest.json` (not from graph.json source_file), as the manifest tracks which source documents were used as Graphify input.

#### Scenario: New page frontmatter
- **WHEN** a wiki file has no existing page_id match
- **THEN** frontmatter SHALL have `status: 'draft'`, `version: 1`, `source: 'graphify'`, `managed_by: 'graphify'`, `curation_status: 'auto_generated'`

#### Scenario: Existing page frontmatter update
- **WHEN** a wiki file matches existing page_id with version 3
- **THEN** frontmatter SHALL have `version: 4`, preserved `status`, updated `graphify_run_id` and `updated_at`

### Requirement: Flat-to-nested directory mapping (Doc 21 §9.2)
Normalization SHALL map Graphify's flat wiki/ output to nested Canonical Wiki Repo structure:
- `index.md` → `spaces/{space_id}/index.md`
- community pages → `spaces/{space_id}/communities/{slug}.md`
- god node pages → `spaces/{space_id}/god-nodes/{slug}.md`
- generated articles → `spaces/{space_id}/pages/{slug}.md`

#### Scenario: Community page path
- **WHEN** page type is "community" and slug is "Auth_System"
- **THEN** target path SHALL be `spaces/{space_id}/communities/Auth_System.md`

### Requirement: Block ownership — section-level granularity (Doc 21 §9.7, Doc 05 §3.4)
Normalization SHALL create section-level (not page-level) block ownership markers and metadata. Each h2 heading defines a block boundary.

For new pages, each section gets a `graphify:managed` block:
```markdown
<!-- graphify:managed:start id="{section_slug}" run="{run_id}" -->
{section content}
<!-- graphify:managed:end -->
```

For existing pages with human-curated blocks, only `graphify:managed` blocks are updated; `human:curated` blocks are preserved.

`page_block_metadata` records SHALL be created per section (not one per page):
- `block_id`: section heading slug
- `owner`: 'graphify' for new/auto sections, 'human' for human-edited sections
- `content_hash`: SHA256 of section content
- `editable`: false for graphify, true for human

#### Scenario: New page with 3 sections
- **WHEN** importing a new page with h2 headings "Overview", "Components", "Sources"
- **THEN** 3 `page_block_metadata` records created, 3 `graphify:managed` marker pairs injected

#### Scenario: Existing page with human section
- **WHEN** re-importing a page where "Components" block has `owner: 'human'`
- **THEN** "Components" section content SHALL NOT be changed, "Overview" and "Sources" (owner: graphify) SHALL be updated

### Requirement: Wiki Markdown sanitization (Doc 12 §6.3)
Before writing to Canonical Wiki Repo, normalization SHALL sanitize Graphify wiki content:
- Strip all HTML tags EXCEPT `<!-- graphify:* -->` comment markers
- Remove `<script>`, `<iframe>`, `<object>`, `<embed>` completely
- Remove `on*=` event handler attributes
- Remove `data:` URIs
- Strip `javascript:` in href/src attributes
- Images: only allow relative paths (`_attachments/`) or whitelisted domains
- External links: add `rel="nofollow noopener"`

#### Scenario: Content with script tags
- **WHEN** Graphify wiki page contains `<script>alert('xss')</script>`
- **THEN** script tag SHALL be completely removed from output

### Requirement: Conflict detection and resolution (Doc 21 §9.8 — all 7 scenarios)

#### Scenario 1: Slug collision — same page
- **WHEN** Graphify slug matches existing page AND page_id matches
- **THEN** execute update (overwrite graphify blocks, preserve human blocks)

#### Scenario 2: Slug collision — different page
- **WHEN** Graphify slug matches existing page BUT page_id differs
- **THEN** Graphify page slug SHALL be appended with `_gf_{run_id_short}` suffix

#### Scenario 3: Label rename (norm_label unchanged)
- **WHEN** Graphify node label changes but norm_label is identical
- **THEN** page_id unchanged, frontmatter `title` updated, file slug updated if changed (git mv), old path gets redirect

#### Scenario 4: Label rename (norm_label changed)
- **WHEN** norm_label changes causing stable_key change
- **THEN** graph-core resolves via graph_node_aliases; if alias match found, reuse stable_key + page_id; if not, create new page

#### Scenario 5: Same god node regenerated
- **WHEN** god node with same stable_key appears in new run
- **THEN** page_id unchanged (`{space}.god-node.{stable_key[:12]}`), only graphify:managed blocks and frontmatter version/run_id updated

#### Scenario 6: Community ID changes (re-clustering)
- **WHEN** Graphify produces different community IDs than previous run
- **THEN** old community pages marked `status: 'deprecated'` (NOT deleted), new community pages created as `status: 'draft'`

#### Scenario 7: GRAPH_REPORT.md placement
- **WHEN** normalization processes GRAPH_REPORT.md
- **THEN** it SHALL be stored in `graph_reports` table and `graphify_runs.report_uri` (MinIO), NOT in Canonical Wiki Repo page directory

### Requirement: Graphify → human block conflict → proposal
When Graphify produces new content for a section that has `owner: 'human'` in page_block_metadata:
- Do NOT overwrite the human content
- Create a `wiki_update_proposals` record with `proposal_type: 'graphify_suggestion'`, `diff_json` containing old human content and new Graphify suggestion
- Phase 1 only records proposals — accept/reject UI is Phase 2

#### Scenario: Generate proposal for conflicting human block
- **WHEN** "Components" section is human-curated and Graphify has different content
- **THEN** `wiki_update_proposals` record created, human content preserved in page

### Requirement: Graph report storage
Normalization SHALL store GRAPH_REPORT.md in the `graph_reports` table (report_markdown field) linked to the graphify_run_id, and parse stats from the report into stats_json.

### Requirement: Index update manifest generation
Normalization SHALL output an `IndexUpdateManifest`:
- `pagesAdded: string[]` (page_ids)
- `pagesUpdated: string[]` (page_ids with content changes)
- `pagesArchived: string[]` (community pages deprecated by re-clustering)
- `graphNodesChanged: number`
- `graphEdgesChanged: number`

This manifest is consumed by Stage 6 indexer.

### Requirement: DB writes — wiki_pages + wiki_page_versions + wiki_sections
For each imported page, normalization SHALL:
1. Create or update `wiki_pages` record
2. Create new `wiki_page_versions` record with `source: 'graphify'`, full markdown content (frontmatter + sanitized + markers)
3. Update `wiki_pages.current_version_id`
4. Call `extractSections()` to create `wiki_sections` records for h2/h3 headings

### Requirement: Git commit generation (Doc 05 §3.5)
Normalization SHALL generate Canonical Wiki Repo git commits with the required format:

Author: `graphify <graphify@cherrygraph.local>`
Message: `[{space_slug}][graphify][{run_id}] {summary}`

Example: `[rd-platform][graphify][gf_001] update 3 pages: auth-system, permission-system, jwt-authentication`

#### Scenario: First import commit
- **WHEN** 4 new pages are imported
- **THEN** commit message SHALL be `[{space}][graphify][{run_id}] add 4 pages: auth-system, permission-system, jwt-authentication, rbac-permission-model`

#### Scenario: Update import commit
- **WHEN** 2 pages updated, 1 new page added
- **THEN** commit message SHALL be `[{space}][graphify][{run_id}] add 1 page, update 2 pages: ...`
