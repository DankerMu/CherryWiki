export type Role = 'owner' | 'admin' | 'space_admin' | 'editor' | 'viewer' | 'auditor';

export const ROLE_OPTIONS: Role[] = ['owner', 'admin', 'space_admin', 'editor', 'viewer', 'auditor'];

export const SPACE_PERMISSION_OPTIONS = ['space:view', 'space:edit', 'space:admin'] as const;

export type SpacePermission = (typeof SPACE_PERMISSION_OPTIONS)[number];

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  groups: string[];
  last_login_at: string | null;
  created_at: string;
};

export type GroupSpacePermissions = {
  space_id: string;
  permissions: string[];
};

export type AdminGroup = {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  spaces: GroupSpacePermissions[];
  created_at: string;
};

export type SpaceStatsSummary = {
  page_count: number;
  source_count: number;
  node_count: number;
};

export type AdminSpace = {
  id: string;
  name: string;
  slug: string;
  status: string;
  description: string | null;
  stats: SpaceStatsSummary;
  created_at: string;
  updated_at: string;
};

export type AdminSpaceDetail = AdminSpace & {
  docmost_space_id: string | null;
  wiki_repo_path: string;
  active_graphify_run_id: string | null;
  active_index_snapshot_id: string | null;
  index_consistency_status: string;
  strict_knowledge_only: boolean;
  graphify_config: unknown;
  default_publish_policy: string;
};

export type SpacePermissionGroup = {
  group_id: string;
  name: string;
  permissions: string[];
};

export type AdminModel = {
  id: string;
  name: string | null;
  provider: string;
  model_id: string;
  model_type: string;
  status: 'active' | 'disabled';
  config: {
    base_url: string | null;
    embedding_dim: number | null;
    max_tokens: number | null;
    rate_limit_rpm: number | null;
  };
  visible_group_ids: string[];
};

export type ModelConnectivityResult = {
  reachable: boolean;
  latency_ms: number;
  error?: string;
};

export type AuditLog = {
  id: string;
  actor_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  space_id: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  metadata_json: unknown;
  created_at: string;
};

export type HealthComponentStatus = 'healthy' | 'degraded' | 'unhealthy' | 'not_configured';

export type HealthComponent = {
  status: HealthComponentStatus;
  latency_ms?: number;
  error?: string;
};

export type SystemHealth = {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: Record<string, HealthComponent>;
  uptime: number;
};

export const ADMIN_JOB_TYPE_FILTER_OPTIONS = ['ingestion', 'graphify', 'reindex', 'rebuild', 'wiki_sync'] as const;

export const ADMIN_JOB_STATUS_OPTIONS = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;

export type JobProgress = {
  percent?: number;
  stage?: string;
};

export type AdminJob = {
  job_id: string;
  type: string;
  status: string;
  space_id: string | null;
  progress: JobProgress | null;
  created_by: string | null;
  payload_json: unknown;
  result_json: unknown;
  error_json: unknown;
  cancel_requested_at: string | null;
  attempt_count: number;
  max_attempts: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export function getDisplayStatus(job: AdminJob): string {
  if (job.status === 'running' && job.cancel_requested_at !== null) {
    return 'cancelling';
  }
  return job.status;
}

export type JobEvent = {
  event: string;
  timestamp: string;
  detail: unknown;
};

export type CancelJobResponse = {
  job_id: string;
  status: string;
  cancel_requested_at: string | null;
};
