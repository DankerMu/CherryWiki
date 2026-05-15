import type { GraphEdge, GraphNode } from '@cherrygraph/graph-core';
import { describe, expect, it } from 'vitest';

import {
  communityFirstRanking,
  DEFAULT_LIGHTRAG_CONFIG,
  entityRelationshipScoring,
  hierarchicalContextAssembly,
  scoreLightRAG,
  type LightRAGConfig,
} from '../lightrag-strategies.js';
import type { GraphCandidate } from '../types.js';

describe('scoreLightRAG', () => {
  it('uses default weights to produce the expected ranking', () => {
    const communityNodeCounts = new Map([
      ['small', 2],
      ['large', 10],
    ]);
    const weaker = scoreLightRAG(makeCandidate('weaker', { effective_confidence_score: 0.3 }), {
      textSimilarity: 0.2,
      communityNodeCounts,
      candidateCommunityId: 'small',
    });
    const stronger = scoreLightRAG(makeCandidate('stronger', { effective_confidence_score: 0.8 }), {
      textSimilarity: 0.9,
      communityNodeCounts,
      candidateCommunityId: 'large',
    });

    expect(DEFAULT_LIGHTRAG_CONFIG).toEqual({
      textSimilarityWeight: 0.4,
      confidenceWeight: 0.3,
      evidenceWeight: 0.2,
      communityNodeRatioWeight: 0.1,
    });
    expect(stronger.score).toBeCloseTo(0.9 * 0.4 + 0.8 * 0.3 + Math.log(3) * 0.2 + 1 * 0.1);
    expect(weaker.score).toBeCloseTo(0.2 * 0.4 + 0.3 * 0.3 + Math.log(3) * 0.2 + 0.2 * 0.1);
    expect([weaker, stronger].sort((left, right) => right.score - left.score).map(({ id }) => id)).toEqual([
      'stronger',
      'weaker',
    ]);
  });

  it('uses custom weights to change ranking behavior', () => {
    const confidenceOnly: LightRAGConfig = {
      textSimilarityWeight: 0,
      confidenceWeight: 1,
      evidenceWeight: 0,
      communityNodeRatioWeight: 0,
    };
    const lowConfidence = makeCandidate('low-confidence', { effective_confidence_score: 0.1 });
    const highConfidence = makeCandidate('high-confidence', { effective_confidence_score: 0.9 });
    const context = {
      textSimilarity: 1,
      communityNodeCounts: new Map([['community', 10]]),
      candidateCommunityId: 'community',
    };

    const scored = [
      scoreLightRAG(lowConfidence, context, confidenceOnly),
      scoreLightRAG(highConfidence, { ...context, textSimilarity: 0.1 }, confidenceOnly),
    ];

    expect(scored.map(({ score }) => score)).toEqual([0.1, 0.9]);
    expect(scored.sort((left, right) => right.score - left.score).map(({ id }) => id)).toEqual([
      'high-confidence',
      'low-confidence',
    ]);
  });

  it('handles zero evidence and null community', () => {
    const scored = scoreLightRAG(makeCandidate('edge-case', { evidence_count: 0 }), {
      textSimilarity: 0.5,
      communityNodeCounts: new Map([['community', 10]]),
      candidateCommunityId: null,
    });

    expect(scored.score).toBeCloseTo(0.5 * 0.4 + 1 * 0.3);
  });
});

describe('communityFirstRanking', () => {
  it('sorts candidates by community size and summary relevance', () => {
    const candidates = [
      makeCandidate('small-community', { score: 0.8, type: 'community' }),
      makeCandidate('large-community', { score: 0.2, type: 'community' }),
      makeCandidate('medium-community', { score: 0.3, type: 'community' }),
    ];
    const communityNodeCounts = new Map([
      ['small-community', 2],
      ['large-community', 10],
      ['medium-community', 6],
    ]);

    const ranked = communityFirstRanking(candidates, communityNodeCounts);

    expect(ranked.map(({ id }) => id)).toEqual([
      'large-community',
      'small-community',
      'medium-community',
    ]);
    expect(candidates.map(({ id }) => id)).toEqual([
      'small-community',
      'large-community',
      'medium-community',
    ]);
  });

  it('handles empty candidates and missing community IDs', () => {
    expect(communityFirstRanking([], new Map())).toEqual([]);

    const ranked = communityFirstRanking(
      [
        makeCandidate('node-without-community', { score: 0.4, type: 'graph_node' }),
        makeCandidate('community', { score: 0.1, type: 'community' }),
      ],
      new Map([['community', 10]]),
    );

    expect(ranked.map(({ id }) => id)).toEqual(['community', 'node-without-community']);
  });
});

describe('entityRelationshipScoring', () => {
  it('returns edge multiplicity times graph candidate confidence', () => {
    expect(entityRelationshipScoring(makeCandidate('entity', { effective_confidence_score: 0.7 }), 4)).toBeCloseTo(
      2.8,
    );
  });

  it('accepts graph-core edge confidence scores', () => {
    const edge: GraphEdge = {
      source: 'alpha',
      target: 'beta',
      relation: 'depends_on',
      confidence: 'EXTRACTED',
      confidence_score: 0.5,
    };

    expect(entityRelationshipScoring(edge, 3)).toBeCloseTo(1.5);
  });
});

describe('hierarchicalContextAssembly', () => {
  it('produces local, community, and global context layers', () => {
    const node: GraphNode = {
      id: 'node-1',
      label: 'Alpha',
      norm_label: 'alpha',
      type: 'Concept',
      community: 'community-1',
    };
    const content = hierarchicalContextAssembly(
      [node, makeCandidate('local-entity', { content: '[Node] Beta' })],
      [makeCandidate('community-summary', { content: 'Community summary' })],
      'Global summary',
    );

    expect(content).toBe(
      [
        '## Local Entities',
        'Alpha (Concept)',
        '[Node] Beta',
        '',
        '## Community Context',
        'Community summary',
        '',
        '## Global Summary',
        'Global summary',
      ].join('\n'),
    );
  });
});

function makeCandidate(id: string, overrides: Partial<GraphCandidate> = {}): GraphCandidate {
  return {
    type: 'graph_node',
    id,
    content: `[Node] ${id}`,
    score: 0,
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 1,
    evidence_count: 2,
    space_id: 'space-1',
    ...overrides,
  };
}
