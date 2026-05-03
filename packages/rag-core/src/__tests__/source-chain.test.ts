import { describe, expect, it } from 'vitest';

import { computeSourceChain } from '../source-chain.js';

describe('computeSourceChain', () => {
  it('computes source ids, graph ids, and minimum chain confidence', async () => {
    const chain = await computeSourceChain('page-1', 'version-1', {
      getSourceLinks: () => [
        { source_document_id: 'source-1' },
        { source_document_id: 'source-1' },
        { source_document_id: 'source-2' },
      ],
      getGraphEvidenceRefs: () => [
        {
          edge_id: 'edge-1',
          source_node_id: 'node-1',
          target_node_id: 'node-2',
          confidence_label: 'EXTRACTED',
          effective_confidence_score: 0.9,
        },
        {
          edge_id: 'edge-2',
          source_node_id: 'node-2',
          target_node_id: 'node-3',
          confidence_label: 'INFERRED',
          effective_confidence_score: 0.65,
        },
      ],
    });

    expect(chain.source_document_ids).toEqual(['source-1', 'source-2']);
    expect(chain.graph_node_ids).toEqual(['node-1', 'node-2', 'node-3']);
    expect(chain.graph_edge_ids).toEqual(['edge-1', 'edge-2']);
    expect(chain.chain_confidence).toBe(0.65);
  });

  it('uses 1.0 confidence when there are no graph edges', async () => {
    const chain = await computeSourceChain('page-1', 'version-1', {
      getSourceLinks: () => [],
      getGraphEvidenceRefs: () => [],
    });

    expect(chain.chain_confidence).toBe(1.0);
    expect(chain.edge_confidences).toEqual([]);
  });

  it('normalizes AMBIGUOUS edges to 0.40 confidence', async () => {
    const chain = await computeSourceChain('page-1', 'version-1', {
      getSourceLinks: () => [],
      getGraphEvidenceRefs: () => [
        {
          edge_id: 'edge-1',
          confidence_label: 'AMBIGUOUS',
          effective_confidence_score: 0.95,
        },
      ],
    });

    expect(chain.edge_confidences).toEqual([{ edge_id: 'edge-1', confidence: 0.4, label: 'AMBIGUOUS' }]);
    expect(chain.chain_confidence).toBe(0.4);
  });

  it('takes the lowest confidence from mixed edge labels', async () => {
    const chain = await computeSourceChain('page-1', 'version-1', {
      getSourceLinks: () => [],
      getGraphEvidenceRefs: () => [
        { edge_id: 'edge-1', confidence_label: 'EXTRACTED', effective_confidence_score: 0.85 },
        { edge_id: 'edge-2', confidence_label: 'AMBIGUOUS', effective_confidence_score: 0.9 },
        { edge_id: 'edge-3', confidence_label: 'INFERRED', effective_confidence_score: 0.55 },
      ],
    });

    expect(chain.chain_confidence).toBe(0.4);
  });
});
