## ADDED Requirements

### Requirement: Vector similarity search
The system SHALL query `embeddings` table joined with `wiki_chunks` using pgvector `<=>` (cosine distance) operator, filtering by: index_snapshot_id = activated snapshot for the space, and acl_json matching the requesting user's space and groups. ACL filter logic: `acl_json->>'space_id' = :spaceId AND (acl_json->'allowed_group_ids' ?| array[:userGroupIds] OR acl_json->'allowed_group_ids' = '[]'::jsonb)`. Results SHALL be ordered by cosine similarity DESC, limited to top-N (default 20).

#### Scenario: Vector search with ACL filter
- **WHEN** a vector search is performed for user in group 'editors' in space 'sp1'
- **THEN** only chunks where acl_json.space_id = 'sp1' AND acl_json.allowed_group_ids contains 'editors' (or is empty array meaning public within space) SHALL be returned

#### Scenario: Snapshot binding
- **WHEN** a vector search is performed
- **THEN** only chunks belonging to the currently activated index_snapshot for that space SHALL be queried

#### Scenario: Empty embedding
- **WHEN** the query embedding cannot be generated (API error)
- **THEN** vector search SHALL return empty results and the system SHALL fall back to BM25-only

### Requirement: BM25 full-text search
The system SHALL query `wiki_chunks` using PostgreSQL `ts_rank_cd` with `to_tsquery('simple', :query)` against the pre-built `tsvector` GIN index (using 'simple' configuration, matching the existing migration). The same ACL and snapshot filters as vector search SHALL apply. Results SHALL be ordered by ts_rank DESC, limited to top-N (default 20).

#### Scenario: BM25 search with simple tokenizer
- **WHEN** a BM25 search is performed with a text query
- **THEN** the system SHALL use `'simple'` text search configuration (whitespace + lowercase normalization)

#### Scenario: BM25 ACL filter
- **WHEN** BM25 search is performed
- **THEN** the same acl_json filtering logic (space_id + allowed_group_ids) as vector search SHALL be applied

### Requirement: RRF fusion
The system SHALL merge vector and BM25 results using Reciprocal Rank Fusion: `score = Σ 1/(k + rank_i)` with k=60. Duplicate chunk_ids SHALL be deduplicated (keeping highest fused score). Final results SHALL be ordered by fused score DESC, limited to top-K (default 8, configurable).

#### Scenario: RRF merge produces unique results
- **WHEN** vector returns chunks [A, B, C] and BM25 returns [B, D, A]
- **THEN** RRF SHALL produce a merged list with each chunk appearing exactly once, scored by combined rank contributions

#### Scenario: Top-K limiting
- **WHEN** RRF produces 15 merged results and top-K is 8
- **THEN** only the top 8 by fused score SHALL be returned

### Requirement: Injection risk demotion
The system SHALL demote chunks with `injection_risk=true` by applying a penalty multiplier (0.3x) to their RRF score. These chunks SHALL still appear in results but ranked lower.

#### Scenario: Injection risk chunk demotion
- **WHEN** a chunk with injection_risk=true has RRF base score 0.05
- **THEN** its effective score SHALL be 0.05 * 0.3 = 0.015

#### Scenario: All results are injection_risk
- **WHEN** all retrieved chunks have injection_risk=true
- **THEN** the system SHALL treat this as a no-hit scenario (no safe chunks available)

### Requirement: Retrieval engine interface
The system SHALL export a `retrieve(params: RetrievalParams): Promise<RetrievalResult[]>` function. RetrievalParams: { query: string, spaceId: string, tenantId: string, userGroupIds: string[], topK?: number }. RetrievalResult: { chunkId: string, content: string, score: number, wikiPagePk: string, sectionId: string|null, sourceChainJson: SourceChainJson, injectionRisk: boolean, pageTitle: string, sectionTitle: string|null }. The function SHALL resolve the activated snapshot for the space internally.

#### Scenario: Full retrieval pipeline
- **WHEN** retrieve() is called with a query
- **THEN** it SHALL: 1) resolve activated index_snapshot for the space, 2) embed the query using ai-core embedding provider, 3) execute vector search with ACL filter (acl_json.space_id + allowed_group_ids ?| userGroupIds), 4) execute BM25 search with same filters, 5) apply RRF fusion, 6) apply injection_risk demotion, 7) return top-K results with metadata

#### Scenario: No activated snapshot
- **WHEN** retrieve() is called for a space with no activated index_snapshot
- **THEN** it SHALL return empty results (not error)
