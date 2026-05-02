import { api, type ApiWrappedResponse, type QueryParams } from './api.js';

export const GRAPHIFY_RUN_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export const GRAPHIFY_RUN_MODES = ['full', 'update', 'incremental'] as const;
export const GRAPHIFY_TRIGGER_TYPES = ['manual', 'scheduled', 'auto'] as const;

export type GraphifyRunStatus = (typeof GRAPHIFY_RUN_STATUSES)[number];
export type GraphifyRunMode = (typeof GRAPHIFY_RUN_MODES)[number];
export type GraphifyTriggerType = (typeof GRAPHIFY_TRIGGER_TYPES)[number];

export type GraphifyInputScope = {
  page_ids?: string[];
  source_document_ids?: string[];
};

export type GraphifyOptions = {
  wiki?: boolean;
  no_viz?: boolean;
  directed?: boolean;
};

export type CreateGraphifyRunParams = {
  mode: GraphifyRunMode;
  trigger_type: GraphifyTriggerType;
  input_scope?: GraphifyInputScope;
  options?: GraphifyOptions;
};

export type GraphifyRunProgress = {
  percent: number;
  stage: string;
};

export type GraphifyRunResult = {
  nodes_created: number;
  nodes_updated: number;
  edges_created: number;
  wiki_pages_generated: number;
  schema_version: string;
  graph_json_uri: string | null;
  report_uri: string | null;
};

export type GraphifyRun = {
  run_id: string;
  space_id: string;
  mode: GraphifyRunMode;
  trigger_type: GraphifyTriggerType;
  status: GraphifyRunStatus;
  progress: GraphifyRunProgress | null;
  input_scope: GraphifyInputScope;
  result: GraphifyRunResult;
  stats_json?: unknown;
  error_json?: unknown;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type GraphifyRunsQuery = QueryParams & {
  space_id?: string;
  status?: string;
  trigger_type?: string;
  page?: number;
  per_page?: number;
  sort?: string;
};

export type CancelGraphifyRunResponse = {
  run_id: string;
  status: string;
};

export type GraphifyReport = {
  run_id: string;
  report_format: string;
  content: string;
  generated_at: string;
};

export type GraphifySummary = {
  run_id: string;
  summary: {
    node_count: number;
    edge_count: number;
    community_count: number;
  };
  top_entities: unknown[];
  schema_version: string;
};

export type GraphifyRunListResponse = ApiWrappedResponse<GraphifyRun[]>;
export type GraphifyRunResponse = ApiWrappedResponse<GraphifyRun>;
export type GraphifyReportResponse = ApiWrappedResponse<GraphifyReport>;
export type GraphifySummaryResponse = ApiWrappedResponse<GraphifySummary>;

export function createGraphifyRun(spaceId: string, params: CreateGraphifyRunParams): Promise<GraphifyRun> {
  return api.post<GraphifyRun>(`/spaces/${encodeURIComponent(spaceId)}/graphify/runs`, params);
}

export function listGraphifyRuns(query: GraphifyRunsQuery = {}): Promise<GraphifyRunListResponse> {
  return api.getWrapped<GraphifyRun[]>('/graphify/runs', query);
}

export function getGraphifyRun(runId: string): Promise<GraphifyRunResponse> {
  return api.getWrapped<GraphifyRun>(`/graphify/runs/${encodeURIComponent(runId)}`);
}

export function cancelGraphifyRun(runId: string): Promise<CancelGraphifyRunResponse> {
  return api.post<CancelGraphifyRunResponse>(`/graphify/runs/${encodeURIComponent(runId)}/cancel`);
}

export function retryGraphifyRun(runId: string): Promise<GraphifyRun> {
  return api.post<GraphifyRun>(`/graphify/runs/${encodeURIComponent(runId)}/retry`);
}

export function getGraphifyReport(runId: string): Promise<GraphifyReportResponse> {
  return api.getWrapped<GraphifyReport>(`/graphify/runs/${encodeURIComponent(runId)}/report`);
}

export function getGraphifySummary(runId: string): Promise<GraphifySummaryResponse> {
  return api.getWrapped<GraphifySummary>(`/graphify/runs/${encodeURIComponent(runId)}/graph`);
}

export function adminListGraphifyRuns(query: GraphifyRunsQuery = {}): Promise<GraphifyRunListResponse> {
  return api.getWrapped<GraphifyRun[]>('/admin/graphify/runs', query);
}

export function adminRetryRun(runId: string): Promise<GraphifyRun> {
  return api.post<GraphifyRun>(`/admin/graphify/runs/${encodeURIComponent(runId)}/retry`);
}

export const graphifyApi = {
  createGraphifyRun,
  listGraphifyRuns,
  getGraphifyRun,
  cancelGraphifyRun,
  retryGraphifyRun,
  getGraphifyReport,
  getGraphifySummary,
  adminListGraphifyRuns,
  adminRetryRun,
};
