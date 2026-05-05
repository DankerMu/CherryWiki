import type {
  GraphPath,
  GraphQueryEdge,
  GraphQueryNode,
  GraphQueryService,
} from '@cherrygraph/graph-core';

import {
  DEFAULT_RETRIEVAL_CONFIG,
  type AmbiguousEdgePolicy,
  type GraphCandidate,
} from './types.js';

export type GraphRetrievalParams = {
  query: string;
  spaceIds: string[];
  activeRunIds: Map<string, string>;
  nodeTopK?: number;
  pathTopK?: number;
  maxHops?: number;
  ambiguousEdgePolicy?: AmbiguousEdgePolicy;
};

const MAX_NODE_TOP_K = 50;
const MAX_PATH_TOP_K = 10;
const MAX_HOPS = 6;

export async function retrieveGraphCandidates(
  params: GraphRetrievalParams,
  graphQueryService: GraphQueryService,
): Promise<GraphCandidate[]> {
  const nodeTopK = Math.min(
    normalizePositiveInteger(params.nodeTopK, DEFAULT_RETRIEVAL_CONFIG.graph_node_top_k),
    MAX_NODE_TOP_K,
  );
  const pathTopK = Math.min(
    normalizePositiveInteger(params.pathTopK, DEFAULT_RETRIEVAL_CONFIG.graph_path_top_k),
    MAX_PATH_TOP_K,
  );
  const maxHops = Math.min(
    normalizePositiveInteger(params.maxHops, DEFAULT_RETRIEVAL_CONFIG.max_path_hops),
    MAX_HOPS,
  );
  const ambiguousEdgePolicy = params.ambiguousEdgePolicy ?? DEFAULT_RETRIEVAL_CONFIG.ambiguous_edge_policy;

  const nodes = await graphQueryService.searchNodes(
    params.query,
    params.spaceIds,
    params.activeRunIds,
    nodeTopK,
  );
  const nodeCandidates = nodes.map(toNodeCandidate);
  const nodePairs = buildTopNodePairs(nodes, 2);
  const pathResults = await Promise.all(
    nodePairs.map(({ source, target }) =>
      graphQueryService.findPath(source.id, target.id, maxHops, params.spaceIds, params.activeRunIds),
    ),
  );

  const pathCandidates = pathResults
    .flat()
    .filter(isUsablePath)
    .filter((path) => ambiguousEdgePolicy !== 'exclude' || !pathHasAmbiguousEdge(path))
    .sort((left, right) => right.total_confidence - left.total_confidence)
    .slice(0, pathTopK)
    .map((path) => toPathCandidate(path, ambiguousEdgePolicy));

  return [...nodeCandidates, ...pathCandidates];
}

function toNodeCandidate(node: GraphQueryNode): GraphCandidate {
  return {
    type: 'graph_node',
    id: node.id,
    content: `[Node] ${node.label} (${node.node_type ?? 'unknown'})`,
    score: normalizeNonNegativeNumber(node.score, 0),
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 1,
    evidence_count: 1,
    space_id: node.space_id,
  };
}

function toPathCandidate(path: GraphPath, ambiguousEdgePolicy: AmbiguousEdgePolicy): GraphCandidate {
  const effectiveConfidenceScore = normalizeNonNegativeNumber(path.total_confidence, 0);
  const evidenceCount = aggregatePathEvidenceCount(path.edges);

  return {
    type: 'graph_path',
    id: makePathId(path),
    content: formatPathContent(path, ambiguousEdgePolicy),
    score: effectiveConfidenceScore,
    confidence_label: confidenceLabelForPath(path.edges, ambiguousEdgePolicy),
    effective_confidence_score: effectiveConfidenceScore,
    evidence_count: evidenceCount,
    space_id: path.edges[0]?.space_id ?? path.nodes[0]?.space_id ?? '',
    graph_edge_ids: path.edges.map((edge) => edge.id),
  };
}

function buildTopNodePairs(
  nodes: GraphQueryNode[],
  maxPairs: number,
): Array<{ source: GraphQueryNode; target: GraphQueryNode }> {
  const pairs: Array<{ source: GraphQueryNode; target: GraphQueryNode }> = [];

  for (let sourceIndex = 0; sourceIndex < nodes.length; sourceIndex += 1) {
    const source = nodes[sourceIndex];
    if (source === undefined) {
      continue;
    }

    for (let targetIndex = sourceIndex + 1; targetIndex < nodes.length; targetIndex += 1) {
      const target = nodes[targetIndex];
      if (target === undefined) {
        continue;
      }

      pairs.push({ source, target });
      if (pairs.length >= maxPairs) {
        return pairs;
      }
    }
  }

  return pairs;
}

function isUsablePath(path: GraphPath): boolean {
  return path.nodes.length >= 2 && path.edges.length > 0;
}

function pathHasAmbiguousEdge(path: GraphPath): boolean {
  return path.edges.some((edge) => normalizeConfidenceLabel(edge.confidence_label) === 'AMBIGUOUS');
}

function makePathId(path: GraphPath): string {
  const edgeIds = path.edges.map((edge) => edge.id).join(':');
  if (edgeIds.length > 0) {
    return `graph_path:${edgeIds}`;
  }

  return `graph_path:${path.nodes.map((node) => node.id).join(':')}`;
}

function formatPathContent(path: GraphPath, ambiguousEdgePolicy: AmbiguousEdgePolicy): string {
  const firstNode = path.nodes[0];
  const segments = [firstNode?.label ?? 'Unknown'];

  for (const [index, edge] of path.edges.entries()) {
    const nextNode = path.nodes[index + 1];
    if (nextNode === undefined) {
      break;
    }

    segments.push(`${edge.relation_type}${annotationForEdge(edge, ambiguousEdgePolicy)}`);
    segments.push(nextNode.label);
  }

  return `[Path] ${segments.join(' → ')} (confidence: ${formatScore(path.total_confidence)})`;
}

function annotationForEdge(edge: GraphQueryEdge, ambiguousEdgePolicy: AmbiguousEdgePolicy): string {
  const label = normalizeConfidenceLabel(edge.confidence_label);
  if (label === 'INFERRED') {
    return '（推断）';
  }

  if (label === 'AMBIGUOUS') {
    return ambiguousEdgePolicy === 'explain_only' ? '（关系待确认）' : '（推断）';
  }

  return '';
}

function confidenceLabelForPath(
  edges: GraphQueryEdge[],
  ambiguousEdgePolicy: AmbiguousEdgePolicy,
): GraphCandidate['confidence_label'] {
  const labels = edges.map((edge) => normalizeConfidenceLabel(edge.confidence_label));
  if (labels.includes('AMBIGUOUS')) {
    return ambiguousEdgePolicy === 'include' ? 'INFERRED' : 'AMBIGUOUS';
  }

  if (labels.includes('INFERRED')) {
    return 'INFERRED';
  }

  return 'EXTRACTED';
}

function normalizeConfidenceLabel(label: string): GraphCandidate['confidence_label'] {
  if (label === 'EXTRACTED' || label === 'INFERRED' || label === 'AMBIGUOUS') {
    return label;
  }

  return 'INFERRED';
}

function aggregatePathEvidenceCount(edges: GraphQueryEdge[]): number {
  return edges.reduce((total, edge) => total + Math.max(0, edge.evidence_count), 0);
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) {
    return '0';
  }

  return score.toFixed(3).replace(/\.?0+$/, '');
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function normalizeNonNegativeNumber(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return value;
}
