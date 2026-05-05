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
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  status TEXT NOT NULL DEFAULT 'active',
  permission_version BIGINT NOT NULL DEFAULT 1,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  permission_version BIGINT NOT NULL DEFAULT 1,
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
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  docmost_space_id TEXT,
  wiki_repo_path TEXT NOT NULL,
  active_graphify_run_id TEXT,
  active_index_snapshot_id TEXT,
  index_consistency_status TEXT NOT NULL DEFAULT 'healthy',
  permission_version BIGINT NOT NULL DEFAULT 1,
  strict_knowledge_only BOOLEAN NOT NULL DEFAULT true,
  graphify_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  database_config JSONB NOT NULL DEFAULT '{"enabled":false}'::jsonb,
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

CREATE TABLE model_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_type TEXT NOT NULL,
  display_name TEXT,
  base_url TEXT,
  encrypted_api_key_ref TEXT,
  embedding_dim INT,
  max_tokens INT,
  rate_limit_rpm INT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  visible_group_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, model_id)
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
  file_blob_id TEXT REFERENCES file_blobs(id),
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
  queue_name TEXT NOT NULL DEFAULT 'default',
  type TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  timeout_seconds INT,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  cancel_requested_at TIMESTAMPTZ,
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

CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE graphify_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  job_id TEXT REFERENCES jobs(id),
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
  stable_key TEXT NOT NULL,
  label TEXT NOT NULL,
  norm_label TEXT,
  type TEXT,
  community_id TEXT,
  wiki_page_pk TEXT REFERENCES wiki_pages(id),
  page_version_id TEXT REFERENCES wiki_page_versions(id),
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  acl_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, space_id, graphify_run_id, node_key)
);

CREATE TABLE graph_node_aliases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  node_stable_key TEXT NOT NULL,
  alias TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'graphify',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, space_id, node_stable_key, alias)
);

CREATE TABLE graph_node_merges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  from_stable_key TEXT NOT NULL,
  to_stable_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  raw_confidence_score DOUBLE PRECISION,
  effective_confidence_score DOUBLE PRECISION,
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

CREATE TABLE wiki_sections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  wiki_page_pk TEXT NOT NULL REFERENCES wiki_pages(id),
  page_version_id TEXT NOT NULL REFERENCES wiki_page_versions(id),
  section_id TEXT NOT NULL,
  heading TEXT NOT NULL,
  level INT NOT NULL DEFAULT 2,
  section_index INT NOT NULL,
  start_offset INT,
  end_offset INT,
  content_hash TEXT,
  acl_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_version_id, section_id)
);

CREATE TABLE page_block_metadata (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  wiki_page_pk TEXT NOT NULL REFERENCES wiki_pages(id),
  page_version_id TEXT NOT NULL REFERENCES wiki_page_versions(id),
  block_id TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT 'graphify',
  content_hash TEXT NOT NULL,
  graphify_run_id TEXT,
  last_editor TEXT REFERENCES users(id),
  editable BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_version_id, block_id)
);

CREATE TABLE wiki_chunks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  wiki_page_pk TEXT NOT NULL REFERENCES wiki_pages(id),
  page_version_id TEXT NOT NULL REFERENCES wiki_page_versions(id),
  section_id TEXT REFERENCES wiki_sections(id),
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT,
  token_count INT,
  index_status TEXT NOT NULL DEFAULT 'pending',
  index_snapshot_id TEXT,
  index_version TEXT,
  indexed_at TIMESTAMPTZ,
  embedding_model_id TEXT,
  injection_risk BOOLEAN NOT NULL DEFAULT false,
  source_chain_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  acl_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (index_snapshot_id, page_version_id, chunk_index)
);

-- Phase 1: 单模型，VECTOR 维度与 model_configs.embedding_dim 对应。
-- 切换 embedding 模型时须全量重建索引快照。
-- Phase 2+: 按 model_config_id 分 collection 或迁移至 Qdrant。
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  chunk_id TEXT NOT NULL REFERENCES wiki_chunks(id) ON DELETE CASCADE,
  model_config_id TEXT NOT NULL REFERENCES model_configs(id),
  embedding VECTOR,
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
  retrieval_mode TEXT NOT NULL DEFAULT 'hybrid_text',
  enable_database BOOLEAN NOT NULL DEFAULT false,
  enable_deep_analysis BOOLEAN NOT NULL DEFAULT false,
  citations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  graph_paths_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE source_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  wiki_page_pk TEXT NOT NULL REFERENCES wiki_pages(id),
  page_version_id TEXT NOT NULL REFERENCES wiki_page_versions(id),
  section_id TEXT REFERENCES wiki_sections(id),
  source_document_id TEXT REFERENCES source_documents(id),
  source_uri TEXT,
  quote_hash TEXT,
  evidence_type TEXT NOT NULL DEFAULT 'reference',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE answer_citations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  message_id TEXT NOT NULL REFERENCES chat_messages(id),
  page_id TEXT,
  page_version_id TEXT REFERENCES wiki_page_versions(id),
  section_id TEXT REFERENCES wiki_sections(id),
  source_link_id TEXT REFERENCES source_links(id),
  graph_node_id TEXT REFERENCES graph_nodes(id),
  graph_edge_id TEXT REFERENCES graph_edges(id),
  graph_path_json JSONB,
  quote TEXT,
  score DOUBLE PRECISION,
  citation_index INT NOT NULL,
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

-- ===== Phase 2: Bridge Events & Webhook Delivery =====
-- bridge_events: Cherry API 接收 Docmost webhook 的幂等记录（依赖 Docmost 集成）
CREATE TABLE bridge_events (
  id TEXT PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'docmost',
  space_id VARCHAR(64),
  page_id VARCHAR(64),
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'received',
  error_json JSONB,
  nonce VARCHAR(64),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bridge_events_event_id_unique UNIQUE (event_id)
);

-- webhook_deliveries: Bridge webhook 投递记录（inbound/outbound）
CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  bridge_event_id TEXT NOT NULL REFERENCES bridge_events(id) ON DELETE CASCADE,
  direction VARCHAR(10) NOT NULL,
  attempt INT NOT NULL DEFAULT 1,
  status_code INT,
  response_time_ms INT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Phase 3: Graph Evidence References (normalized) =====
-- 将 graph_edges.evidence_refs_json 规范化为独立表，支持反向查询
CREATE TABLE graph_evidence_refs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  edge_id TEXT NOT NULL REFERENCES graph_edges(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES wiki_pages(id),
  page_version_id TEXT REFERENCES wiki_page_versions(id),
  section_id TEXT REFERENCES wiki_sections(id),
  source_document_id TEXT REFERENCES source_documents(id),
  quote_text TEXT,
  confidence_contribution DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Phase 1: Permission Versions =====
-- ACL 变更历史，支持权限审计和回滚
CREATE TABLE permission_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  actor_user_id TEXT REFERENCES users(id),
  change_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  old_permissions_json JSONB,
  new_permissions_json JSONB NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Phase 4: API Tokens =====
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token_hash)
);

-- ===== Phase 1: Sessions =====
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  refresh_token_hash TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (refresh_token_hash)
);

-- ===== Phase 3: Model Usage Logs =====
CREATE TABLE model_usage_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT REFERENCES users(id),
  model_config_id TEXT NOT NULL REFERENCES model_configs(id),
  request_type TEXT NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  latency_ms INT,
  space_id TEXT REFERENCES spaces(id),
  conversation_id TEXT REFERENCES chat_conversations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Phase 1: System Settings =====
CREATE TABLE system_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  updated_by TEXT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category, key)
);

-- ===== Indexes =====

CREATE INDEX idx_spaces_consistency ON spaces(index_consistency_status);
CREATE INDEX idx_wiki_pages_indexed_version ON wiki_pages(indexed_version_id);
CREATE INDEX idx_wiki_pages_current_indexed ON wiki_pages(current_version_id, indexed_version_id);
CREATE INDEX idx_wiki_versions_status ON wiki_page_versions(tenant_id, space_id, status, created_at DESC);
CREATE INDEX idx_wiki_chunks_space ON wiki_chunks(tenant_id, space_id);
CREATE INDEX idx_wiki_chunks_fts ON wiki_chunks USING GIN (to_tsvector('simple', content));
CREATE INDEX idx_graph_nodes_label_trgm ON graph_nodes USING GIN (label gin_trgm_ops);
CREATE INDEX idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX idx_graph_edges_target ON graph_edges(target_node_id);
CREATE INDEX idx_graph_edges_confidence ON graph_edges(confidence_label, effective_confidence_score);
CREATE INDEX idx_wiki_chunks_index_status ON wiki_chunks(index_status, index_snapshot_id);
CREATE INDEX idx_index_snapshots_space ON index_snapshots(tenant_id, space_id, status);
CREATE INDEX idx_index_snapshots_active ON index_snapshots(space_id, activated_at DESC);
CREATE INDEX idx_graph_nodes_stable_key ON graph_nodes(tenant_id, space_id, stable_key);
CREATE INDEX idx_graph_node_aliases_lookup ON graph_node_aliases(tenant_id, space_id, alias);
CREATE INDEX idx_graph_node_merges_from ON graph_node_merges(tenant_id, space_id, from_stable_key);
CREATE INDEX idx_wiki_sections_page_version ON wiki_sections(page_version_id);
CREATE INDEX idx_page_blocks_page_version ON page_block_metadata(page_version_id);
CREATE INDEX idx_page_blocks_owner ON page_block_metadata(wiki_page_pk, owner);
CREATE INDEX idx_source_links_page_version ON source_links(page_version_id);
CREATE INDEX idx_source_links_source_doc ON source_links(source_document_id);
CREATE INDEX idx_answer_citations_message ON answer_citations(message_id);
CREATE INDEX idx_jobs_poll ON jobs(queue_name, status, priority, next_run_at) WHERE status = 'pending';
CREATE INDEX idx_jobs_locked ON jobs(locked_by, locked_at) WHERE locked_by IS NOT NULL;
CREATE INDEX idx_job_events_job ON job_events(job_id, created_at);
CREATE INDEX idx_jobs_space ON jobs(tenant_id, space_id, type, status);
CREATE INDEX idx_graphify_runs_job ON graphify_runs(job_id);
CREATE INDEX idx_model_configs_tenant_type ON model_configs(tenant_id, model_type, enabled);
CREATE INDEX idx_embeddings_model ON embeddings(model_config_id);
CREATE INDEX idx_audit_logs_tenant_time ON audit_logs(tenant_id, created_at DESC);

-- P2 Bridge indexes
CREATE INDEX idx_bridge_events_space_type_received ON bridge_events(space_id, event_type, received_at DESC);
CREATE INDEX idx_bridge_events_pending ON bridge_events(status) WHERE status IN ('received', 'processing');
CREATE INDEX idx_webhook_deliveries_event_attempt ON webhook_deliveries(bridge_event_id, attempt);
CREATE INDEX idx_webhook_deliveries_direction_created ON webhook_deliveries(direction, created_at DESC);
CREATE INDEX idx_graph_evidence_refs_edge ON graph_evidence_refs(edge_id);
CREATE INDEX idx_graph_evidence_refs_page ON graph_evidence_refs(page_id, page_version_id);
CREATE INDEX idx_graph_evidence_refs_source_doc ON graph_evidence_refs(source_document_id);
CREATE INDEX idx_permission_versions_space ON permission_versions(tenant_id, space_id, created_at DESC);
CREATE INDEX idx_permission_versions_subject ON permission_versions(subject_type, subject_id);
CREATE INDEX idx_spaces_permission_version ON spaces(tenant_id, id, permission_version);
CREATE INDEX idx_users_permission_version ON users(tenant_id, id, permission_version);
CREATE INDEX idx_groups_permission_version ON groups(tenant_id, id, permission_version);

-- P2 indexes
CREATE INDEX idx_api_tokens_user ON api_tokens(tenant_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_user ON sessions(tenant_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_refresh ON sessions(refresh_token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_model_usage_logs_user ON model_usage_logs(tenant_id, user_id, created_at DESC);
CREATE INDEX idx_model_usage_logs_model ON model_usage_logs(model_config_id, created_at DESC);
CREATE INDEX idx_system_settings_lookup ON system_settings(tenant_id, category, key);
