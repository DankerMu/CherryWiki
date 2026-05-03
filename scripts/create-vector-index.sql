-- Enable pgvector before creating vector columns or indexes.
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the HNSW index after choosing the Phase 1 embedding model.
-- Run with psql -v embedding_dim=<model_configs.embedding_dim> (for example 1536 or 3072).
-- The embeddings.embedding column intentionally uses VECTOR without a fixed dimension in the base schema
-- so a model switch can be handled by rebuilding the active index snapshot and recreating this index.
--
-- Example:
--   psql "$DATABASE_URL" -v embedding_dim=1536 -f scripts/create-vector-index.sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_embeddings_embedding_hnsw
  ON embeddings USING hnsw ((embedding::vector(:embedding_dim)) vector_cosine_ops);
