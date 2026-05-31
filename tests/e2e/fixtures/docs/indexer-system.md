# Indexer and Search System

The CherryWiki indexer builds vector embeddings and BM25 indexes from wiki pages for hybrid retrieval.

## Indexing Pipeline

1. **Chunking**: Wiki pages split into overlapping chunks (512 tokens, 64 token overlap)
2. **Embedding**: Each chunk embedded via configurable embedding model (default: text-embedding-3-large, 3072 dimensions)
3. **BM25 Tokenization**: Chunks tokenized for full-text search using PostgreSQL tsvector
4. **Snapshot Creation**: Embeddings + BM25 data grouped into an `index_snapshot` with version tag
5. **Activation**: New snapshot set as active for the space; old snapshots retained for rollback

## Retrieval Modes

- **vector_only**: Pure cosine similarity search on embeddings
- **bm25_only**: Full-text search with PostgreSQL ts_rank
- **hybrid** (default): RRF (Reciprocal Rank Fusion) combining vector + BM25 results
- **graph_rag**: Three-source fusion including graph candidate retrieval

## wiki_chunks Table

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| wiki_page_id | uuid | FK to wiki_pages |
| space_id | uuid | Denormalized for query efficiency |
| content | text | Chunk text content |
| embedding | vector(3072) | pgvector embedding |
| tsv | tsvector | BM25 search vector |
| chunk_index | int | Position within page |
| snapshot_id | uuid | FK to index_snapshots |

## Source Chain

Each retrieval result carries a `source_chain_json` documenting:
- Original source_document → parsed.md → graph_node → wiki_page → wiki_chunk
- This chain enables citation verification back to the uploaded file
