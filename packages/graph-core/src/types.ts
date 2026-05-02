export interface GraphNode {
  id: string;
  label: string;
  norm_label: string;
  type: string;
  community: string | null;
  source_file?: string;
  source_location?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  confidence: string;
  confidence_score: number;
}

export interface GraphOutput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hyperedges: unknown[];
}

export type ConfidenceLabel = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export interface GraphCommunity {
  community_key: string;
  label: string;
  node_count: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  validNodes: GraphNode[];
  validEdges: GraphEdge[];
}

export interface ConfidenceMapping {
  raw_confidence_score: number;
  effective_confidence_score: number;
}

export interface ImportStats {
  nodesCreated: number;
  nodesMatched: number;
  edgesCreated: number;
  communitiesCreated: number;
  aliasesCreated: number;
  warnings: string[];
  shrinkDetected: boolean;
}

export interface ImportNodeOperation {
  nodeKey: string;
  stableKey: string;
  label: string;
  normLabel: string;
  type: string;
  communityId: string | null;
  sourceRefsJson: unknown[];
}

export interface ImportEdgeOperation {
  sourceNodeKey: string;
  targetNodeKey: string;
  relationType: string;
  confidenceLabel: ConfidenceLabel;
  rawScore: number;
  effectiveScore: number;
  evidenceCount: number;
}

export interface ImportOperation {
  nodes: ImportNodeOperation[];
  edges: ImportEdgeOperation[];
  communities: GraphCommunity[];
  aliases: Array<{ stableKey: string; alias: string }>;
  stats: ImportStats;
}

export interface ValidGraphOutput {
  validNodes: GraphNode[];
  validEdges: GraphEdge[];
}

export interface ImportRunOptions {
  existingStableKeys?: Set<string>;
  previousNodeCount?: number;
}
