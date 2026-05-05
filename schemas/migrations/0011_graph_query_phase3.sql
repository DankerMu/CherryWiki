-- Add database_config column to spaces
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS database_config JSONB NOT NULL DEFAULT '{"enabled":false}'::jsonb;

-- Create retrieval_traces table
CREATE TABLE IF NOT EXISTS retrieval_traces (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT REFERENCES users(id),
  conversation_id TEXT REFERENCES chat_sessions(id),
  space_ids TEXT[] NOT NULL,
  query TEXT NOT NULL,
  retrieval_mode TEXT NOT NULL,
  candidates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  acl_filtered_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_context_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create model_usage_logs table
CREATE TABLE IF NOT EXISTS model_usage_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT REFERENCES users(id),
  model_config_id TEXT NOT NULL REFERENCES model_configs(id),
  request_type TEXT NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  latency_ms INT,
  space_id TEXT REFERENCES spaces(id),
  conversation_id TEXT REFERENCES chat_sessions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_usage_logs_user ON model_usage_logs(tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_usage_logs_model ON model_usage_logs(model_config_id, created_at DESC);
