CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE group_members (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  docmost_space_id TEXT,
  wiki_repo_path TEXT NOT NULL,
  active_graphify_run_id TEXT,
  active_index_snapshot_id TEXT,
  index_consistency_status TEXT NOT NULL DEFAULT 'healthy',
  graphify_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_publish_policy TEXT NOT NULL DEFAULT 'editor_publish',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE space_permissions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  group_id TEXT NOT NULL REFERENCES groups(id),
  permission TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, group_id, permission)
);

CREATE TABLE wiki_pages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  page_id TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  current_version_id TEXT,
  indexed_version_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'synced',
  docmost_page_id TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, space_id, page_id)
);

CREATE TABLE wiki_page_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  wiki_page_pk TEXT NOT NULL REFERENCES wiki_pages(id),
  page_id TEXT NOT NULL,
  version_no INT NOT NULL,
  content_markdown TEXT NOT NULL,
  frontmatter_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL,
  graphify_run_id TEXT,
  commit_hash TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (wiki_page_pk, version_no)
);

ALTER TABLE wiki_pages
  ADD CONSTRAINT fk_wiki_pages_current_version
  FOREIGN KEY (current_version_id) REFERENCES wiki_page_versions(id);

ALTER TABLE wiki_pages
  ADD CONSTRAINT fk_wiki_pages_indexed_version
  FOREIGN KEY (indexed_version_id) REFERENCES wiki_page_versions(id);

CREATE TABLE file_blobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  sha256 TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sha256)
);

CREATE TABLE source_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  file_blob_id TEXT NOT NULL REFERENCES file_blobs(id),
  filename TEXT NOT NULL,
  uploader_id TEXT REFERENCES users(id),
  source_type TEXT NOT NULL DEFAULT 'upload',
  classification TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded',
  parsed_uri TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, file_blob_id)
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT REFERENCES spaces(id),
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB,
  error_json JSONB,
  idempotency_key TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE graphify_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  trigger_type TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input_version TEXT,
  output_version TEXT,
  graphify_ref TEXT,
  graph_json_uri TEXT,
  wiki_output_uri TEXT,
  report_uri TEXT,
  graph_html_uri TEXT,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_json JSONB,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE graph_nodes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  graphify_run_id TEXT NOT NULL REFERENCES graphify_runs(id),
  node_key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT,
  community_id TEXT,
  wiki_page_pk TEXT REFERENCES wiki_pages(id),
  page_version_id TEXT REFERENCES wiki_page_versions(id),
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  acl_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, space_id, graphify_run_id, node_key)
);

CREATE TABLE graph_edges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  graphify_run_id TEXT NOT NULL REFERENCES graphify_runs(id),
  source_node_id TEXT NOT NULL REFERENCES graph_nodes(id),
  target_node_id TEXT NOT NULL REFERENCES graph_nodes(id),
  relation_type TEXT NOT NULL,
  confidence_label TEXT NOT NULL,
  confidence_score DOUBLE PRECISION,
  evidence_count INT NOT NULL DEFAULT 1,
  evidence_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  acl_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE graph_communities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  graphify_run_id TEXT NOT NULL REFERENCES graphify_runs(id),
  community_key TEXT NOT NULL,
  label TEXT,
  summary TEXT,
  node_count INT NOT NULL DEFAULT 0,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, space_id, graphify_run_id, community_key)
);

CREATE TABLE wiki_chunks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  wiki_page_pk TEXT NOT NULL REFERENCES wiki_pages(id),
  page_version_id TEXT NOT NULL REFERENCES wiki_page_versions(id),
  section_id TEXT,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT,
  token_count INT,
  index_status TEXT NOT NULL DEFAULT 'pending',
  index_snapshot_id TEXT,
  index_version TEXT,
  indexed_at TIMESTAMPTZ,
  embedding_model_id TEXT,
  acl_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_version_id, chunk_index)
);

CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  chunk_id TEXT NOT NULL REFERENCES wiki_chunks(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  embedding VECTOR(3072),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE graph_reports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  graphify_run_id TEXT NOT NULL REFERENCES graphify_runs(id),
  report_markdown TEXT NOT NULL,
  stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wiki_update_proposals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  wiki_page_pk TEXT REFERENCES wiki_pages(id),
  graphify_run_id TEXT REFERENCES graphify_runs(id),
  proposal_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  diff_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE index_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  graphify_run_id TEXT REFERENCES graphify_runs(id),
  wiki_repo_commit_hash TEXT NOT NULL,
  embedding_model_id TEXT NOT NULL,
  chunk_count INT NOT NULL DEFAULT 0,
  node_count INT NOT NULL DEFAULT 0,
  edge_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'building',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ
);

CREATE TABLE consistency_checks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  status TEXT NOT NULL,
  findings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE chat_conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  graph_paths_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE retrieval_traces (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT REFERENCES users(id),
  conversation_id TEXT REFERENCES chat_conversations(id),
  space_ids TEXT[] NOT NULL,
  query TEXT NOT NULL,
  retrieval_mode TEXT NOT NULL,
  candidates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  acl_filtered_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_context_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feedback_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT REFERENCES users(id),
  message_id TEXT REFERENCES chat_messages(id),
  space_id TEXT REFERENCES spaces(id),
  feedback_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  space_id TEXT,
  ip TEXT,
  user_agent TEXT,
  request_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spaces_consistency ON spaces(index_consistency_status);
CREATE INDEX idx_wiki_pages_indexed_version ON wiki_pages(indexed_version_id);
CREATE INDEX idx_wiki_pages_current_indexed ON wiki_pages(current_version_id, indexed_version_id);
CREATE INDEX idx_wiki_versions_status ON wiki_page_versions(tenant_id, space_id, status, created_at DESC);
CREATE INDEX idx_wiki_chunks_space ON wiki_chunks(tenant_id, space_id);
CREATE INDEX idx_wiki_chunks_fts ON wiki_chunks USING GIN (to_tsvector('simple', content));
CREATE INDEX idx_graph_nodes_label_trgm ON graph_nodes USING GIN (label gin_trgm_ops);
CREATE INDEX idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX idx_graph_edges_target ON graph_edges(target_node_id);
CREATE INDEX idx_graph_edges_confidence ON graph_edges(confidence_label, confidence_score);
CREATE INDEX idx_wiki_chunks_index_status ON wiki_chunks(index_status, index_snapshot_id);
CREATE INDEX idx_index_snapshots_space ON index_snapshots(tenant_id, space_id, status);
CREATE INDEX idx_index_snapshots_active ON index_snapshots(space_id, activated_at DESC);
CREATE INDEX idx_audit_logs_tenant_time ON audit_logs(tenant_id, created_at DESC);
