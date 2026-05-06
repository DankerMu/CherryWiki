import { JobRepository, QueueFactory } from '@cherrygraph/job-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TEST_SPACE_ID,
  createEdgeRow,
  createGovernanceContext,
  createGovernanceServiceContext,
  createJobRow,
  createQueueMock,
} from './governance-test-utils.js';

describe('governance low-confidence flow integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('P4-E1 lists low-confidence edges, confirms, rejects, re-reviews, and reindexes each mutation', async () => {
    const { service, db } = createGovernanceServiceContext({ redis: {} as never });
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(createQueueMock() as never);
    vi.spyOn(JobRepository, 'create')
      .mockResolvedValueOnce(createJobRow({ id: 'job-confirm' }))
      .mockResolvedValueOnce(createJobRow({ id: 'job-reject' }))
      .mockResolvedValueOnce(createJobRow({ id: 'job-rereview' }));
    db.queueExecute({
      rows: [
        {
          edge_id: 'edge-1',
          source_node_id: 'node-a',
          source_node_label: 'Service A',
          target_node_id: 'node-b',
          target_node_label: 'Service B',
          relation_type: 'depends_on',
          effective_confidence_score: '0.4',
          raw_confidence_score: '0.7',
          confidence_label: 'AMBIGUOUS',
          evidence_count: '1',
          space_id: TEST_SPACE_ID,
        },
      ],
    });

    const queue = await service.listLowConfidenceEdges({}, createGovernanceContext());
    expect(queue.items).toHaveLength(1);

    db.queueSelect([createEdgeRow({ raw_confidence_score: 0.7 })]);
    db.queueUpdate([createEdgeRow({ raw_confidence_score: 0.7, effective_confidence_score: 0.9, confidence_label: 'EXTRACTED' })]);
    const confirmed = await service.reviewEdge(
      'edge-1',
      { action: 'confirm', effective_score: 0.9, reason: 'Verified' },
      createGovernanceContext(),
    );

    db.queueSelect([createEdgeRow({ raw_confidence_score: 0.7, effective_confidence_score: 0.9, confidence_label: 'EXTRACTED' })]);
    db.queueUpdate([createEdgeRow({ raw_confidence_score: 0.7, effective_confidence_score: 0, confidence_label: 'REJECTED' })]);
    const rejected = await service.reviewEdge('edge-1', { action: 'reject', reason: 'False relation' }, createGovernanceContext());

    db.queueSelect([createEdgeRow({ raw_confidence_score: 0.7, effective_confidence_score: 0, confidence_label: 'REJECTED' })]);
    db.queueUpdate([createEdgeRow({ raw_confidence_score: 0.7, effective_confidence_score: 0.7, confidence_label: 'INFERRED' })]);
    const restored = await service.reviewEdge(
      'edge-1',
      { action: 'confirm', effective_score: 0.7, reason: 'Restored' },
      createGovernanceContext(),
    );

    expect(confirmed).toMatchObject({ confidence_label: 'EXTRACTED', raw_confidence_score: 0.7 });
    expect(rejected).toMatchObject({ confidence_label: 'REJECTED', effective_confidence_score: 0, raw_confidence_score: 0.7 });
    expect(restored).toMatchObject({ confidence_label: 'INFERRED', effective_confidence_score: 0.7, raw_confidence_score: 0.7 });
    expect(vi.mocked(JobRepository.create)).toHaveBeenCalledTimes(3);
  });
});
