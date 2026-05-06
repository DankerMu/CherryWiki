import type { FeedbackService } from '../../apps/api/src/feedback/feedback.service.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TEST_SPACE_ID,
  createConflictEdgeRow,
  createGovernanceContext,
  createGovernanceServiceContext,
} from './governance-test-utils.js';

describe('governance conflicts integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('P4-E12 detects contradictory edges and edge-chunk mismatches, persists them, and lists open conflict feedback', async () => {
    const createConflictFeedback = vi.fn<FeedbackService['createConflictFeedback']>(() =>
      Promise.resolve({ id: 'feedback-conflict' } as never),
    );
    const { service, db } = createGovernanceServiceContext({
      feedbackService: { createConflictFeedback } as unknown as FeedbackService,
    });
    db.queueSelect([]);
    db.queueExecute({
      rows: [
        createConflictEdgeRow({ edge_id: 'edge-depends', relation_type: 'depends_on', confidence_label: 'EXTRACTED' }),
        createConflictEdgeRow({ edge_id: 'edge-independent', relation_type: 'independent_of', confidence_label: 'EXTRACTED' }),
      ],
    });
    db.queueExecute({
      rows: [
        {
          ...createConflictEdgeRow({
            edge_id: 'edge-mismatch',
            relation_type: 'depends_on',
            confidence_label: 'INFERRED',
          }),
          chunk_id: 'chunk-1',
          chunk_content: 'Service A is independent of Service B.',
        },
      ],
    });
    db.queueSelect([
      {
        id: 'feedback-edge',
        payload_json: {
          conflict_type: 'contradictory_edges',
          entity_pair: {
            source_node_id: 'node-a',
            target_node_id: 'node-b',
            source_label: 'Service A',
            target_label: 'Service B',
          },
          conflicting_items: [{ edge_id: 'edge-depends' }, { edge_id: 'edge-independent' }],
          severity: 'high',
          fingerprint: 'contradictory_edges:node-a:node-b:edge-depends:edge-independent',
        },
      },
      {
        id: 'feedback-chunk',
        payload_json: {
          conflict_type: 'edge_chunk_mismatch',
          entity_pair: {
            source_node_id: 'node-a',
            target_node_id: 'node-b',
            source_label: 'Service A',
            target_label: 'Service B',
          },
          conflicting_items: [{ edge_id: 'edge-mismatch' }, { chunk_id: 'chunk-1' }],
          severity: 'medium',
          fingerprint: 'edge_chunk_mismatch:edge-mismatch:chunk-1',
        },
      },
    ]);

    const result = await service.listConflicts({ space_id: TEST_SPACE_ID }, createGovernanceContext());

    expect(createConflictFeedback).toHaveBeenCalledTimes(2);
    expect(result.items).toEqual([
      expect.objectContaining({
        conflict_id: 'feedback-edge',
        conflict_type: 'contradictory_edges',
        severity: 'high',
      }),
      expect.objectContaining({
        conflict_id: 'feedback-chunk',
        conflict_type: 'edge_chunk_mismatch',
        severity: 'medium',
      }),
    ]);
  });
});
