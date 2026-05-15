/*
 * LightRAG retrieval strategy adaptations.
 *
 * Source project: https://github.com/HKUDS/LightRAG
 * License note: LightRAG is MIT licensed, which is compatible with this
 * project's AGPL-3.0 license for adapted algorithmic ideas.
 * Adapted algorithms: local_query, global_query, and hybrid_query retrieval
 * ranking/context assembly patterns from lightrag/operate.py.
 *
 * This module is a native TypeScript implementation. It does not import or
 * execute LightRAG Python code at runtime.
 */

import type { GraphEdge, GraphNode } from '@cherrygraph/graph-core';

import type { GraphCandidate } from './types.js';

export type LightRAGConfig = {
  textSimilarityWeight: number;
  confidenceWeight: number;
  evidenceWeight: number;
  communityNodeRatioWeight: number;
};

export const DEFAULT_LIGHTRAG_CONFIG: LightRAGConfig = {
  textSimilarityWeight: 0.4,
  confidenceWeight: 0.3,
  evidenceWeight: 0.2,
  communityNodeRatioWeight: 0.1,
};

export type ScoringContext = {
  textSimilarity: number;
  communityNodeCounts: Map<string, number>;
  candidateCommunityId: string | null;
};

type CandidateWithCommunity = GraphCandidate & {
  community_id?: string | null;
  communityId?: string | null;
  community?: string | null;
};

export function communityFirstRanking<TCandidate extends GraphCandidate>(
  candidates: readonly TCandidate[],
  communityNodeCounts: Map<string, number>,
): TCandidate[] {
  const maxCommunityNodeCount = maxMapValue(communityNodeCounts);

  return [...candidates].sort((left, right) => {
    const leftScore = communityFirstScore(left, communityNodeCounts, maxCommunityNodeCount);
    const rightScore = communityFirstScore(right, communityNodeCounts, maxCommunityNodeCount);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return left.id.localeCompare(right.id);
  });
}

export function entityRelationshipScoring(
  candidate: Pick<GraphCandidate, 'effective_confidence_score'> | GraphEdge,
  edgeMultiplicity: number,
): number {
  return normalizeNonNegativeNumber(edgeMultiplicity) * confidenceScore(candidate);
}

export function hierarchicalContextAssembly(
  localEntities: readonly (GraphCandidate | GraphNode | string)[],
  communityContexts: readonly (GraphCandidate | string)[],
  globalSummary: GraphCandidate | string | null | undefined,
): string {
  const sections = [
    formatSection('Local Entities', localEntities.map(formatContextItem)),
    formatSection('Community Context', communityContexts.map(formatContextItem)),
    formatSection('Global Summary', globalSummary == null ? [] : [formatContextItem(globalSummary)]),
  ];

  return sections.filter((section) => section.length > 0).join('\n\n');
}

export function scoreLightRAG<TCandidate extends GraphCandidate>(
  candidate: TCandidate,
  context: ScoringContext,
  config: LightRAGConfig = DEFAULT_LIGHTRAG_CONFIG,
): TCandidate {
  const score =
    normalizeNonNegativeNumber(context.textSimilarity) * normalizeNumber(config.textSimilarityWeight) +
    normalizeNonNegativeNumber(candidate.effective_confidence_score) * normalizeNumber(config.confidenceWeight) +
    Math.log(1 + normalizeNonNegativeNumber(candidate.evidence_count)) * normalizeNumber(config.evidenceWeight) +
    communityNodeRatio(context.candidateCommunityId, context.communityNodeCounts) *
      normalizeNumber(config.communityNodeRatioWeight);

  return {
    ...candidate,
    score,
  };
}

function communityFirstScore(
  candidate: GraphCandidate,
  communityNodeCounts: Map<string, number>,
  maxCommunityNodeCount: number,
): number {
  const communityId = communityIdForCandidate(candidate);
  const ratio =
    communityId === null || maxCommunityNodeCount <= 0
      ? 0
      : normalizeNonNegativeNumber(communityNodeCounts.get(communityId)) / maxCommunityNodeCount;

  return normalizeNonNegativeNumber(candidate.score) + ratio;
}

function communityIdForCandidate(candidate: GraphCandidate): string | null {
  const candidateWithCommunity = candidate as CandidateWithCommunity;

  if (typeof candidateWithCommunity.community_id === 'string') {
    return candidateWithCommunity.community_id;
  }

  if (typeof candidateWithCommunity.communityId === 'string') {
    return candidateWithCommunity.communityId;
  }

  if (typeof candidateWithCommunity.community === 'string') {
    return candidateWithCommunity.community;
  }

  if (candidate.type === 'community') {
    return candidate.id;
  }

  return null;
}

function communityNodeRatio(
  candidateCommunityId: string | null,
  communityNodeCounts: Map<string, number>,
): number {
  if (candidateCommunityId === null) {
    return 0;
  }

  const maxCommunityNodeCount = maxMapValue(communityNodeCounts);
  if (maxCommunityNodeCount <= 0) {
    return 0;
  }

  return normalizeNonNegativeNumber(communityNodeCounts.get(candidateCommunityId)) / maxCommunityNodeCount;
}

function maxMapValue(values: Map<string, number>): number {
  let maxValue = 0;

  for (const value of values.values()) {
    maxValue = Math.max(maxValue, normalizeNonNegativeNumber(value));
  }

  return maxValue;
}

function confidenceScore(candidate: Pick<GraphCandidate, 'effective_confidence_score'> | GraphEdge): number {
  if ('effective_confidence_score' in candidate) {
    return normalizeNonNegativeNumber(candidate.effective_confidence_score);
  }

  return normalizeNonNegativeNumber(candidate.confidence_score);
}

function formatContextItem(item: GraphCandidate | GraphNode | string): string {
  if (typeof item === 'string') {
    return item.trim();
  }

  if ('content' in item) {
    return item.content.trim();
  }

  const typeSuffix = item.type.length > 0 ? ` (${item.type})` : '';
  return `${item.label}${typeSuffix}`.trim();
}

function formatSection(label: string, items: string[]): string {
  const content = items.map((item) => item.trim()).filter((item) => item.length > 0);
  if (content.length === 0) {
    return '';
  }

  return [`## ${label}`, ...content].join('\n');
}

function normalizeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalizeNonNegativeNumber(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return value;
}
