import 'reflect-metadata';

import type { RetrievalResult } from '@cherrygraph/rag-core';
import { describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../audit/audit.service.js';
import { ChatService } from '../chat.service.js';

describe('source-chain citations', () => {
  it('preserves graph_edge_ids when expanding answer citations', () => {
    const service = new ChatService({} as never, { push: vi.fn() } as unknown as AuditService);
    const [citation] = service.extractCitations('Use the relation [^1].', [
      createRetrievalResult({
        sourceChainJson: {
          source_document_ids: ['doc-1'],
          graph_node_ids: ['node-a', 'node-b'],
          graph_edge_ids: ['edge-1'],
          edge_confidences: [{ edge_id: 'edge-1', confidence: 0.8, label: 'INFERRED' }],
          chain_confidence: 0.8,
        },
      }),
    ]);

    expect(citation?.source_chain_json).toMatchObject({
      source_document_ids: ['doc-1'],
      graph_node_ids: ['node-a', 'node-b'],
      graph_edge_ids: ['edge-1'],
      edge_confidences: [{ edge_id: 'edge-1', confidence: 0.8, label: 'INFERRED' }],
    });
  });
});

function createRetrievalResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    chunkId: 'chunk-1',
    content: 'A depends on B.',
    score: 0.9,
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
    sectionTitle: 'Dependencies',
    ...overrides,
  };
}
