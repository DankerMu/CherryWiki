import { JobRepository, QueueFactory } from '@cherrygraph/job-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createEdgeRow,
  createGovernanceContext,
  createGovernanceServiceContext,
  createJobRow,
  createQueueMock,
} from './governance-test-utils.js';

describe('governance reindex trigger integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('P4-E7 creates governance_action indexer jobs after governance mutations', async () => {
    const { service, db } = createGovernanceServiceContext({ redis: {} as never });
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(createQueueMock() as never);
    const createJobSpy = vi.spyOn(JobRepository, 'create').mockResolvedValue(createJobRow({ id: 'job-review' }));
    db.queueSelect([createEdgeRow()]);
    db.queueUpdate([createEdgeRow({ effective_confidence_score: 0.86, confidence_label: 'EXTRACTED' })]);

    await service.reviewEdge(
      'edge-1',
      { action: 'confirm', effective_score: 0.86, reason: 'Verified' },
      createGovernanceContext(),
    );

    expect(createJobSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'reindex',
        payload_json: expect.objectContaining({
          trigger: 'governance_action',
          scope: 'full',
          governance_action: 'edge_review',
        }),
      }),
    );
  });
});
