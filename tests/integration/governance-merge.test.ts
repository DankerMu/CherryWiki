import { JobRepository, QueueFactory } from '@cherrygraph/job-core';
import { graphNodeMerges, wikiPages } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createGovernanceContext,
  createGovernanceServiceContext,
  createJobRow,
  createPageRow,
  createQueueMock,
} from './governance-test-utils.js';

describe('governance merge integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('P4-E2 suggests duplicates and merges source page into redirect target', async () => {
    const { service, db } = createGovernanceServiceContext({ redis: {} as never });
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(createQueueMock() as never);
    vi.spyOn(JobRepository, 'create').mockResolvedValue(createJobRow({ id: 'job-merge' }));
    db.queueExecute({
      rows: [
        {
          page_a_id: 'react-setup',
          page_b_id: 'reactjs-setup',
          page_a_title: 'React Setup',
          page_b_title: 'ReactJS Setup',
          similarity_score: '0.91',
          suggested_target: 'react-setup',
        },
      ],
    });

    const suggestions = await service.listDuplicateSuggestions({}, createGovernanceContext());
    expect(suggestions.items[0]).toMatchObject({
      page_a_id: 'react-setup',
      page_b_id: 'reactjs-setup',
      suggested_target: 'react-setup',
    });

    db.queueSelect([createPageRow({ id: 'from-pk', page_id: 'reactjs-setup' })]);
    db.queueSelect([createPageRow({ id: 'to-pk', page_id: 'react-setup' })]);
    db.queueSelect([{ stable_key: 'stable-reactjs' }]);
    db.queueSelect([{ stable_key: 'stable-react' }]);
    db.queueUpdate([createPageRow({ id: 'from-pk', page_id: 'reactjs-setup', status: 'merged', sync_status: 'redirect:react-setup' })]);

    const result = await service.mergePages(
      { from_page_id: 'reactjs-setup', to_page_id: 'react-setup', reason: 'Near duplicate' },
      createGovernanceContext(),
    );

    expect(db.inserts[0]?.table).toBe(graphNodeMerges);
    expect(db.updates[0]?.table).toBe(wikiPages);
    expect(db.updates[0]?.value).toMatchObject({
      status: 'merged',
      sync_status: 'redirect:react-setup',
    });
    expect(result).toMatchObject({
      from_page_id: 'reactjs-setup',
      to_page_id: 'react-setup',
      sync_status: 'redirect:react-setup',
      reindex_job_id: 'job-merge',
    });
  });
});
