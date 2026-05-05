export type ChunkOptions = {
  maxChunkTokens?: number;
  overlapTokens?: number;
};

export type GraphCandidateType = 'graph_node' | 'graph_edge' | 'graph_path' | 'community';

export type GraphCandidate = {
  type: GraphCandidateType;
  id: string;
  content: string;
  score: number;
  confidence_label: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
  effective_confidence_score: number;
  evidence_count: number;
  space_id: string;
  page_ids?: string[];
  graph_edge_ids?: string[];
};

export type AmbiguousEdgePolicy = 'exclude' | 'explain_only' | 'include';

export type RetrievalConfig = {
  graph_node_top_k: number;
  graph_path_top_k: number;
  max_path_hops: number;
  graph_neighbor_hops: number;
  context_token_budget: number;
  wiki_context_budget: number;
  graph_context_budget: number;
  community_summary_budget: number;
  ambiguous_edge_policy: AmbiguousEdgePolicy;
};

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  graph_node_top_k: 20,
  graph_path_top_k: 5,
  max_path_hops: 4,
  graph_neighbor_hops: 2,
  context_token_budget: 12000,
  wiki_context_budget: 8000,
  graph_context_budget: 2500,
  community_summary_budget: 1500,
  ambiguous_edge_policy: 'exclude',
};

export const STATIC_RAG_MODES = ['wiki_only'] as const;
export const AGENT_RAG_MODES = ['graph_rag', 'path_first', 'community_first'] as const;
export type RetrievalMode = (typeof STATIC_RAG_MODES)[number] | (typeof AGENT_RAG_MODES)[number];

export const DEFAULT_STATIC_RETRIEVAL_CONFIG: RetrievalConfig = {
  ...DEFAULT_RETRIEVAL_CONFIG,
  community_summary_budget: 0,
};

export function retrievalConfigForMode(
  mode: RetrievalMode,
  overrides: Partial<RetrievalConfig> = {},
): RetrievalConfig {
  const baseConfig = mode === 'wiki_only' ? DEFAULT_STATIC_RETRIEVAL_CONFIG : DEFAULT_RETRIEVAL_CONFIG;
  const mergedConfig = { ...baseConfig, ...overrides };

  return mode === 'wiki_only' ? { ...mergedConfig, community_summary_budget: 0 } : mergedConfig;
}

export type SourceChainJson = {
  source_document_ids: string[];
  graph_node_ids: string[];
  graph_edge_ids: string[];
  edge_confidences: Array<{ edge_id: string; confidence: number; label: string }>;
  chain_confidence: number;
};

export type AclJson = {
  tenant_id: string;
  space_id: string;
  allowed_group_ids: string[];
  classification: string;
  page_id: string;
  page_version: number;
};

export type ChunkResult = {
  chunk_index: number;
  content: string;
  content_hash: string;
  token_count: number;
  section_id: string | null;
  injection_risk: boolean;
  source_chain_json: SourceChainJson;
  acl_json: AclJson;
};
