import type {
  GraphCommunitySummary,
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
import { scoreLightRAG } from './lightrag-strategies.js';

export type GraphRetrievalParams = {
  query: string;
  spaceIds: string[];
  activeRunIds: Map<string, string>;
  nodeTopK?: number;
  pathTopK?: number;
  maxHops?: number;
  ambiguousEdgePolicy?: AmbiguousEdgePolicy;
};

export type GraphRetrievalMode = 'local' | 'global' | 'hybrid';

export type FullGraphRetrievalParams = {
  query: string;
  spaceIds: string[];
  activeRunIds: Map<string, string>;
  mode?: GraphRetrievalMode;
  nodeTopK?: number;
  neighborExpansionTopK?: number;
  maxCandidates?: number;
};

const MAX_NODE_TOP_K = 50;
const MAX_PATH_TOP_K = 10;
const MAX_HOPS = 6;
const DEFAULT_NEIGHBOR_EXPANSION_TOP_K = 5;
const DEFAULT_MAX_CANDIDATES = 30;
const MAX_FULL_GRAPH_CANDIDATES = 30;

type CandidateWithScoringContext = {
  candidate: GraphCandidate;
  textSimilarity: number;
  communityId: string | null;
};

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

export async function retrieveFullGraphContext(
  params: FullGraphRetrievalParams,
  graphQueryService: GraphQueryService,
): Promise<GraphCandidate[]> {
  const mode = params.mode ?? 'hybrid';
  const nodeTopK = Math.min(
    normalizePositiveInteger(params.nodeTopK, DEFAULT_RETRIEVAL_CONFIG.graph_node_top_k),
    MAX_NODE_TOP_K,
  );
  const neighborExpansionTopK = Math.min(
    normalizePositiveInteger(params.neighborExpansionTopK, DEFAULT_NEIGHBOR_EXPANSION_TOP_K),
    MAX_NODE_TOP_K,
  );
  const maxCandidates = Math.min(
    normalizePositiveInteger(params.maxCandidates, DEFAULT_MAX_CANDIDATES),
    MAX_FULL_GRAPH_CANDIDATES,
  );
  const nodes = await graphQueryService.searchNodes(
    params.query,
    params.spaceIds,
    params.activeRunIds,
    nodeTopK,
  );

  if (nodes.length === 0) {
    return [];
  }

  const communities = mode === 'local' ? [] : await graphQueryService.getCommunities(params.spaceIds, params.activeRunIds);
  const communityNodeCounts = buildCommunityNodeCounts(communities);
  const candidateContexts: CandidateWithScoringContext[] = [];

  if (mode === 'local' || mode === 'hybrid') {
    candidateContexts.push(
      ...(await retrieveLocalCandidateContexts(nodes, neighborExpansionTopK, params, graphQueryService)),
    );
  }

  if (mode === 'global' || mode === 'hybrid') {
    candidateContexts.push(...retrieveGlobalCandidateContexts(nodes, communities));
  }

  return dedupeCandidateContexts(candidateContexts)
    .map(({ candidate, textSimilarity, communityId }) =>
      scoreLightRAG(candidate, {
        textSimilarity,
        communityNodeCounts,
        candidateCommunityId: communityId,
      }),
    )
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, maxCandidates);
}

function toNodeCandidate(node: GraphQueryNode): GraphCandidate {
  return {
    type: 'graph_node',
    id: node.id,
    content: formatNodeContent(node),
    score: normalizeNonNegativeNumber(node.score, 0),
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 1,
    evidence_count: 1,
    space_id: node.space_id,
  };
}

function toCommunityCandidate(community: GraphCommunitySummary): GraphCandidate {
  return {
    type: 'community',
    id: community.id,
    content: formatCommunityContent(community),
    score: 0,
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 1,
    evidence_count: Math.max(1, normalizePositiveInteger(community.node_count, 1)),
    space_id: '',
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

async function retrieveLocalCandidateContexts(
  nodes: GraphQueryNode[],
  neighborExpansionTopK: number,
  params: FullGraphRetrievalParams,
  graphQueryService: GraphQueryService,
): Promise<CandidateWithScoringContext[]> {
  const candidateContexts = nodes.map((node) => toNodeCandidateContext(node, node.score));
  const expansionNodes = nodes.slice(0, neighborExpansionTopK).filter((node) => node.community_id !== null);
  const topNodePairs = buildAllTopNodePairs(nodes.slice(0, DEFAULT_NEIGHBOR_EXPANSION_TOP_K));
  const [communityNodeResults, oneHopPathResults] = await Promise.all([
    Promise.all(
      expansionNodes.map((node) =>
        graphQueryService.getCommunityNodes(node.community_id!, params.spaceIds, params.activeRunIds),
      ),
    ),
    Promise.all(
      topNodePairs.map(({ source, target }) =>
        graphQueryService.findPath(source.id, target.id, 1, params.spaceIds, params.activeRunIds),
      ),
    ),
  ]);
  const searchScoreByCommunityId = new Map<string, number>();
  const searchScoreByNodeId = new Map<string, number>();

  for (const node of nodes) {
    searchScoreByNodeId.set(node.id, normalizeNonNegativeNumber(node.score, 0));

    if (node.community_id === null) {
      continue;
    }

    searchScoreByCommunityId.set(
      node.community_id,
      Math.max(searchScoreByCommunityId.get(node.community_id) ?? 0, normalizeNonNegativeNumber(node.score, 0)),
    );
  }

  for (const communityResult of communityNodeResults) {
    for (const node of communityResult.nodes) {
      candidateContexts.push(toNodeCandidateContext(node, searchScoreByCommunityId.get(node.community_id ?? '') ?? node.score));
    }
  }

  for (const path of oneHopPathResults.flat()) {
    if (!isUsablePath(path)) {
      continue;
    }

    const pathScore = normalizeNonNegativeNumber(path.total_confidence, 0);
    for (const node of path.nodes) {
      candidateContexts.push(toNodeCandidateContext(node, searchScoreByNodeId.get(node.id) ?? pathScore));
    }
  }

  return candidateContexts;
}

function retrieveGlobalCandidateContexts(
  nodes: GraphQueryNode[],
  communities: GraphCommunitySummary[],
): CandidateWithScoringContext[] {
  const communityScoreById = new Map<string, number>();

  for (const node of nodes) {
    if (node.community_id === null) {
      continue;
    }

    communityScoreById.set(
      node.community_id,
      Math.max(communityScoreById.get(node.community_id) ?? 0, normalizeNonNegativeNumber(node.score, 0)),
    );
  }

  return communities
    .filter((community) => communityScoreById.has(community.id))
    .map((community) => ({
      candidate: toCommunityCandidate(community),
      textSimilarity: communityScoreById.get(community.id) ?? 0,
      communityId: community.id,
    }));
}

function toNodeCandidateContext(node: GraphQueryNode, textSimilarity: number): CandidateWithScoringContext {
  return {
    candidate: toNodeCandidate(node),
    textSimilarity: normalizeNonNegativeNumber(textSimilarity, 0),
    communityId: node.community_id,
  };
}

function dedupeCandidateContexts(
  candidateContexts: CandidateWithScoringContext[],
): CandidateWithScoringContext[] {
  const byKey = new Map<string, CandidateWithScoringContext>();

  for (const candidateContext of candidateContexts) {
    const key = `${candidateContext.candidate.type}:${candidateContext.candidate.id}`;
    const existing = byKey.get(key);
    if (
      existing === undefined ||
      candidateContext.textSimilarity > existing.textSimilarity ||
      candidateContext.candidate.evidence_count > existing.candidate.evidence_count
    ) {
      byKey.set(key, candidateContext);
    }
  }

  return Array.from(byKey.values());
}

function buildCommunityNodeCounts(communities: GraphCommunitySummary[]): Map<string, number> {
  return new Map(communities.map((community) => [community.id, Math.max(0, community.node_count)]));
}

function formatNodeContent(node: GraphQueryNode): string {
  const type = node.node_type ?? 'unknown';
  const description = node.description?.trim();
  if (description !== undefined && description.length > 0) {
    return `[Node] ${node.label} (${type}): ${description}`;
  }

  return `[Node] ${node.label} (${type})`;
}

function formatCommunityContent(community: GraphCommunitySummary): string {
  const label = community.label ?? community.community_key;
  const summary = community.summary?.trim();
  if (summary !== undefined && summary.length > 0) {
    return `[Community] ${label}: ${summary}`;
  }

  return `[Community] ${label} (${community.node_count} nodes)`;
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

function buildAllTopNodePairs(nodes: GraphQueryNode[]): Array<{ source: GraphQueryNode; target: GraphQueryNode }> {
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
