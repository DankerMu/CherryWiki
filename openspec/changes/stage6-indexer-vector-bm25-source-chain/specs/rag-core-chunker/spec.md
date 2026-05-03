## ADDED Requirements

### Requirement: Section-aware page chunking
The system SHALL chunk a wiki page by splitting on wiki_sections boundaries first. Each chunk MUST belong to exactly one section. If a section's content exceeds max_chunk_tokens (default 512), the system SHALL split within the section at paragraph or sentence boundaries, with overlap of chunk_overlap_tokens (default 64).

#### Scenario: page with multiple sections under token limit
- **WHEN** a page has 3 sections each under 512 tokens
- **THEN** produces 3 chunks, each with section_id set to the corresponding wiki_section

#### Scenario: section exceeding token limit
- **WHEN** a section has 1500 tokens of content
- **THEN** produces 3-4 chunks from that section, each ≤ 512 tokens, with chunk_overlap_tokens overlap between consecutive chunks within the section

#### Scenario: page with no sections
- **WHEN** a page has no wiki_sections entries
- **THEN** treats the entire page content as one implicit section and chunks by token window

#### Scenario: empty page
- **WHEN** a page has empty content
- **THEN** produces zero chunks

### Requirement: chunk_index sequential assignment
The system SHALL assign chunk_index as a zero-based sequential integer per page_version_id, maintaining section order and within-section chunk order.

#### Scenario: chunk ordering
- **WHEN** a page with 2 sections (section_index=0 has 2 chunks, section_index=1 has 1 chunk)
- **THEN** chunk_index values are 0, 1, 2 in order

### Requirement: content_hash computation
The system SHALL compute content_hash as SHA-256 hex digest of the chunk content string. This hash is used for incremental indexing deduplication.

#### Scenario: identical content produces same hash
- **WHEN** two chunks have identical content text
- **THEN** their content_hash values are identical

#### Scenario: different content produces different hash
- **WHEN** two chunks have different content text
- **THEN** their content_hash values differ

### Requirement: token_count computation
The system SHALL compute token_count for each chunk using the token counting utility from ai-core. This count is used for context budget management during retrieval.

#### Scenario: token count stored per chunk
- **WHEN** a chunk is created with content "Hello world, this is a test"
- **THEN** token_count is a positive integer reflecting the model-specific token count

### Requirement: source_chain_json precomputation
The system SHALL precompute source_chain_json for each chunk at indexing time per Doc 09 §8.4. The JSON structure SHALL match Doc 09 §8.4 exactly, stored as the nested `source_chain` object within the JSONB field: { source_document_ids: string[], graph_node_ids: string[], graph_edge_ids: string[], edge_confidence: string | null, chain_confidence: number }. The outer context fields (chunk_id, page_id, page_version_id, section_id) are stored in separate wiki_chunks columns, not duplicated in source_chain_json.

#### Scenario: chunk with graph associations
- **WHEN** a chunk's page has source_links to src_001 and graph_evidence_refs pointing to node_sso (edge confidence EXTRACTED, effective_confidence_score 0.90)
- **THEN** source_chain_json = { source_document_ids: ["src_001"], graph_node_ids: ["node_sso"], graph_edge_ids: ["edge_sso_oauth2"], edge_confidence: "EXTRACTED", chain_confidence: 0.90 }

#### Scenario: chunk without graph associations
- **WHEN** a chunk's page has no graph_evidence_refs entries
- **THEN** source_chain_json = { source_document_ids: [...], graph_node_ids: [], graph_edge_ids: [], edge_confidence: null, chain_confidence: 1.0 }

#### Scenario: chunk with AMBIGUOUS edge
- **WHEN** the weakest edge in the chain has effective_confidence_score 0.40 and label AMBIGUOUS
- **THEN** chain_confidence = 0.40 and edge_confidence = "AMBIGUOUS"

#### Scenario: multiple edges with mixed confidence
- **WHEN** chain references edges with EXTRACTED (0.90) and INFERRED (0.70)
- **THEN** chain_confidence = 0.70 (lowest effective_confidence_score) and edge_confidence = "INFERRED" (weakest label)

### Requirement: injection_risk propagation
The system SHALL set chunk injection_risk = true if any of: (a) the source_document associated with the page has injection_risk in its metadata_json (field name: `metadata_json`, not `metadata`), or (b) the chunk content matches known injection patterns from the existing pattern library at `apps/api/src/uploads/validators/prompt-injection-patterns.ts`. The chunker SHALL reuse (import) this existing pattern set rather than maintaining a separate list.

#### Scenario: source document flagged
- **WHEN** a chunk belongs to a page whose source_document has metadata_json.injection_risk = true
- **THEN** chunk.injection_risk = true

#### Scenario: content matches injection pattern
- **WHEN** chunk content contains "ignore all previous instructions" (matching existing prompt-injection-patterns.ts)
- **THEN** chunk.injection_risk = true

#### Scenario: clean content
- **WHEN** chunk content has no injection patterns and source document is clean
- **THEN** chunk.injection_risk = false

### Requirement: acl_json snapshot
The system SHALL populate chunk acl_json matching Doc 10 §4 ACL envelope structure exactly: tenant_id, space_id, allowed_group_ids (from space_permissions + group_members), classification (from Space config, default 'internal'), page_id, page_version (from the version being indexed).

#### Scenario: ACL snapshot computed
- **WHEN** a chunk is created for space_rd with groups ["group_rd", "group_arch"] and default classification
- **THEN** acl_json contains { tenant_id, space_id: "space_rd", allowed_group_ids: ["group_rd", "group_arch"], classification: "internal", page_id, page_version }

### Requirement: Chunker output contract
The system SHALL export a `chunkPage(page, version, sections, options): ChunkResult[]` function returning an array of chunk objects ready for database insertion. Each ChunkResult SHALL contain: content, chunk_index, section_id, content_hash, token_count, source_chain_json, injection_risk, acl_json.

#### Scenario: full chunking pipeline
- **WHEN** chunkPage is called with a valid page, version, and sections
- **THEN** returns ChunkResult[] with all required fields populated
