import 'reflect-metadata';

import {
  DEFAULT_RETRIEVAL_CONFIG,
  packContext,
  type GraphCandidate,
  type SearchHit,
} from '@cherrygraph/rag-core';
import { describe, expect, it } from 'vitest';

describe('graph chunk conflict policy', () => {
  it('keeps wiki chunk context and annotates conflicting graph paths', () => {
    const packed = packContext(
      [
        { type: 'wiki_chunk', hit: createSearchHit('ServiceA is not connected to ServiceB.'), score: 1 },
        {
          type: 'graph',
          candidate: createGraphPathCandidate('[Path] ServiceA → calls → ServiceB (confidence: 0.8)'),
          score: 0.9,
        },
      ],
      DEFAULT_RETRIEVAL_CONFIG,
      countWords,
    );

    expect(packed.wiki_context).toContain('not connected');
    expect(packed.graph_context).toContain('图谱中存在关系');
    expect(packed.conflict_annotations).toHaveLength(1);
  });
});

function createSearchHit(content: string): SearchHit {
  return {
    chunkId: 'chunk-1',
    spaceId: 'space-1',
    content,
    score: 1,
    wikiPagePk: 'wiki-page-1',
    sectionId: 'section-1',
    sourceChainJson: {
      source_document_ids: [],
      graph_node_ids: [],
      graph_edge_ids: [],
      edge_confidences: [],
      chain_confidence: 1,
    },
    injectionRisk: false,
    pageTitle: 'Architecture',
    sectionTitle: 'Services',
  };
}

function createGraphPathCandidate(content: string): GraphCandidate {
  return {
    type: 'graph_path',
    id: 'path-1',
    content,
    score: 0.8,
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 0.8,
    evidence_count: 2,
    space_id: 'space-1',
    graph_edge_ids: ['edge-1'],
  };
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
