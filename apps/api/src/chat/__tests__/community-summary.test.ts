import 'reflect-metadata';

import { DEFAULT_RETRIEVAL_CONFIG, packContext, type GraphCandidate } from '@cherrygraph/rag-core';
import { describe, expect, it } from 'vitest';

describe('community summary context', () => {
  it('packs community summaries into the dedicated community context budget', () => {
    const packed = packContext(
      [
        {
          type: 'graph',
          candidate: createCommunityCandidate('Auth services share SSO, token refresh, and session policies.'),
          score: 0.95,
        },
      ],
      DEFAULT_RETRIEVAL_CONFIG,
      countWords,
    );

    expect(packed.community_context).toContain('Auth services');
    expect(packed.graph_context).toBe('');
  });
});

function createCommunityCandidate(content: string): GraphCandidate {
  return {
    type: 'community',
    id: 'community-1',
    content,
    score: 1,
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 1,
    evidence_count: 3,
    space_id: 'space-1',
  };
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
