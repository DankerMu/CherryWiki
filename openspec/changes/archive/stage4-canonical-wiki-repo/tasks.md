## 1. Drizzle Schema + Validation

- [x] 1.1 Add wikiPages, wikiPageVersions, wikiSections, sourceLinks Drizzle table definitions to `packages/shared/src/schema/core.ts` (matching schema.sql exactly)
- [x] 1.2 Add post-definition FK constraints for wiki_pages.current_version_id and indexed_version_id (ALTER TABLE style, not DEFERRABLE)
- [x] 1.3 Add all 6 indexes: idx_wiki_pages_indexed_version, idx_wiki_pages_current_indexed, idx_wiki_versions_status, idx_wiki_sections_page_version, idx_source_links_page_version, idx_source_links_source_doc
- [x] 1.4 Export new tables from `packages/shared/src/schema/index.ts`
- [x] 1.5 Add Zod validation schemas to `packages/shared/src/schema/validation.ts`: insertWikiPageSchema, insertWikiPageVersionSchema, publishRequestSchema, rollbackRequestSchema
- [x] 1.6 Write tests for Zod validation schemas in `packages/shared/src/schema/__tests__/validation.test.ts`
- [x] 1.7 Generate Drizzle migration, verify it runs against existing DB with wiki tables from seed

## 2. wiki-core Package

- [x] 2.1 Implement `parseFrontmatter(markdown)` — extract YAML frontmatter delimited by `---`, return typed `WikiFrontmatter`
- [x] 2.2 Define `WikiFrontmatter` type with all Doc 21 §9.5 standard fields: page_id, title, space_id, page_type, status, curation_status, source, graphify_run_id, graphify_schema_version, managed_by, source_document_ids, graph_node_ids, version, acl_hash, created_by, created_at, updated_at
- [x] 2.3 Implement `generateFrontmatter(frontmatter, content)` — prepend YAML frontmatter to markdown
- [x] 2.4 Implement `generateSlug(label, existingSlugs?)` — replicate Graphify `_safe_filename()`: `/`→`-`, space→`_`, `:`→`-`; dedup via `_2`/`_3` suffix
- [x] 2.5 Implement `generatePageId(spaceId, pageType, stableKey)` — per Doc 21 §9.4: `{space_id}.{type_prefix}.{stable_key}`
- [x] 2.6 Implement `PublishStateMachine` — enforce draft→published, reject double-publish, rollback creates new version
- [x] 2.7 Implement `extractSections(markdown, pageId)` — parse h2/h3 headings only (per Doc 21 §9.6), generate section_id as `{page_id}#heading-{slugify(heading_text)}`
- [x] 2.8 Implement version management helpers: auto-increment version_no, getLatestVersionNo
- [x] 2.9 Export all public API from `packages/wiki-core/src/index.ts`
- [x] 2.10 Write unit tests for frontmatter parser/generator (valid with all Doc 21 fields, empty, missing frontmatter, round-trip)
- [x] 2.11 Write unit tests for slug generator (basic space→underscore, special chars, dedup with `_2`, Chinese preserved)
- [x] 2.12 Write unit tests for page_id generator (community, god_node, generated_article, index types)
- [x] 2.13 Write unit tests for PublishStateMachine (all transitions + rejection cases)
- [x] 2.14 Write unit tests for section extractor (h2/h3 only, h1 excluded, anchor format, empty input)

## 3. API Wiki Module

- [x] 3.1 Create `apps/api/src/wiki/` module structure: wiki.module.ts, wiki.controller.ts, wiki.service.ts
- [x] 3.2 Implement WikiService: page CRUD with Drizzle (list with pagination/filter/search, get, getContent, listVersions)
- [x] 3.3 Implement WikiService: publish logic — validate version status, update page current_version_id, derive published_at/published_by from audit timestamp, write `wiki.page.publish` audit
- [x] 3.4 Implement WikiService: rollback logic — copy target version content, create new version, auto-publish, write `wiki.page.rollback` audit
- [x] 3.5 Implement WikiController: 6 endpoints with SpacePermissionGuard (`space:view` for reads, `wiki:publish` for publish, `wiki:rollback` for rollback)
- [x] 3.7 Register WikiModule in app.module.ts
- [x] 3.8 Write controller tests: all 6 endpoints happy path + `WIKI_PAGE_NOT_FOUND` + `VERSION_NOT_FOUND` + `VERSION_ALREADY_PUBLISHED` + permission denied (403)
- [x] 3.9 Write service tests: publish state transitions, rollback version creation, audit event emission with correct action names
- [x] 3.10 Write integration tests: cross-space permission isolation (page/content/versions all denied), publish→list shows published, rollback creates new version, idempotency key

## 4. Cherry Web — Wiki UI

- [x] 4.1 Add Wiki API client functions to frontend API layer (listPages, getPage, getContent, listVersions, publish, rollback)
- [x] 4.2 Implement WikiPageList component: paginated list with status badges, search, status filter
- [x] 4.3 Implement WikiPageDetail component: rendered Markdown (react-markdown + remark-gfm + rehype-highlight)
- [x] 4.4 Implement WikiVersionHistory component: version list with source labels, click to view version content
- [x] 4.5 Implement publish/rollback action buttons (gated by `wiki:publish`/`wiki:rollback` permissions, not by role name)
- [x] 4.6 Add Wiki routes to router: /spaces/:spaceId/wiki, /spaces/:spaceId/wiki/:pageId, /spaces/:spaceId/wiki/:pageId/history
- [x] 4.7 Add "Wiki" entry to Space sidebar navigation with active state
- [x] 4.8 Add empty state for spaces with no wiki pages
- [x] 4.9 Install react-markdown, remark-gfm, rehype-highlight dependencies
- [x] 4.10 Write frontend component tests: page list rendering, empty state, version history display

## 5. Canonical Wiki Repo Initialization

- [x] 5.1 Implement repo initialization: create `wiki-repo/spaces/{space_id}/` directory structure per Doc 05 §3.1 (pages/, communities/, god-nodes/, _attachments/, _metadata/)
- [x] 5.2 Wire repo init to Space creation: when a Space is created, `spaces.wiki_repo_path` is set and the directory structure is initialized
- [x] 5.3 Implement `_metadata/pages.jsonl` initialization (empty file, populated by Stage 5 Graphify import)
- [x] 5.4 Write tests: repo init creates correct directory structure, idempotent on existing repo, wiki_repo_path matches space

## 6. Source Links Foundation

- [x] 5.1 Implement source_links CRUD functions in wiki-core: createSourceLink, batchCreateSourceLinks, queryByPageVersion
- [x] 5.2 Write unit tests for source_links CRUD
- [x] 5.3 Verify source_links referential integrity with wiki_pages, wiki_page_versions, wiki_sections, source_documents

## 7. Verification & Cleanup

- [x] 7.1 Run full lint + typecheck across monorepo (pnpm lint && pnpm typecheck)
- [x] 7.2 Run all unit tests with coverage (pnpm test -- --coverage)
- [x] 7.3 Run integration tests (pnpm exec vitest run tests/integration/)
- [x] 7.4 Verify CI passes on PR branch
- [x] 7.5 Update 需求追踪矩阵 (26_需求追踪矩阵.md): fill test file paths for Wiki-related rows (Canonical Wiki Repo 写入, Wiki 页面浏览, Wiki 页面内容, Wiki 发布), add source_links row
