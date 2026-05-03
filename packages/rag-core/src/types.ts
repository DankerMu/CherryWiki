export type ChunkOptions = {
  maxChunkTokens?: number;
  overlapTokens?: number;
};

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
