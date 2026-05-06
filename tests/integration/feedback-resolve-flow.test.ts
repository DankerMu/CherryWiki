import {
  JobRepository,
  QueueFactory,
  QUEUE_INDEXING,
  type JobRow,
} from '@cherrygraph/job-core';
import { feedbackItems } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ScriptedDb,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
} from '../../apps/api/src/users/__tests__/user-group-service-test-utils.js';
import { FeedbackService } from '../../apps/api/src/feedback/feedback.service.js';

describe('feedback resolve flow integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('P4-E3 submits feedback, resolves it, stores the resolution note, and creates a reindex job', async () => {
    const db = new ScriptedDb();
    const audit = createAuditMock();
    const service = new FeedbackService(db.asDrizzle(), audit.service, {} as never);
    const queue = createQueueMock();
    const createJobSpy = vi.spyOn(JobRepository, 'create').mockResolvedValue(createJobRow({ id: 'job-feedback' }));
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(queue as never);

    const created = await service.createFeedback(
      {
        feedback_type: 'outdated',
        payload_json: {
          page_id: 'page-1',
          description: 'Page needs current SSO notes',
        },
      },
      {
        tenantId: TEST_TENANT_ID,
        actorUserId: TEST_USER_ID,
        spaceId: TEST_SPACE_ID,
      },
    );
    const feedbackForResolve = createFeedbackRow({
      ...created,
      created_at: new Date('2026-05-01T10:00:00.000Z'),
    });
    const resolved = createFeedbackRow({
      ...feedbackForResolve,
      status: 'resolved',
      resolved_by: 'admin-1',
      resolved_at: new Date('2026-05-02T10:00:00.000Z'),
      resolution_note: 'accepted: Page updated',
    });
    db.queueSelect([feedbackForResolve]);
    db.queueUpdate([resolved]);
    db.queueSelect([
      {
        id: 'wiki-page-pk-1',
        page_id: 'page-1',
        space_id: TEST_SPACE_ID,
        updated_at: new Date('2026-05-02T09:00:00.000Z'),
      },
    ]);

    const result = await service.resolveFeedback(created.id, { resolution: 'accepted', notes: 'Page updated' }, {
      tenantId: TEST_TENANT_ID,
      actorUserId: 'admin-1',
    });

    expect(result.resolution_note).toBe('accepted: Page updated');
    expect(db.updates[0]?.value).toMatchObject({
      status: 'resolved',
      resolved_by: 'admin-1',
      resolution_note: 'accepted: Page updated',
    });
    expect(createJobSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        space_id: TEST_SPACE_ID,
        queue_name: QUEUE_INDEXING,
        type: 'reindex',
        payload_json: expect.objectContaining({
          feedback_id: created.id,
          page_id: 'page-1',
          trigger: 'feedback_resolved',
        }),
      }),
    );
    expect(queue.add).toHaveBeenCalledWith('reindex', { jobId: 'job-feedback' });
  });
});

function createFeedbackRow(overrides: Partial<typeof feedbackItems.$inferSelect> = {}): typeof feedbackItems.$inferSelect {
  return {
    id: 'feedback-1',
    tenant_id: TEST_TENANT_ID,
    user_id: TEST_USER_ID,
    message_id: null,
    space_id: TEST_SPACE_ID,
    feedback_type: 'outdated',
    status: 'open',
    payload_json: { page_id: 'page-1' },
    created_at: new Date('2026-05-01T10:00:00.000Z'),
    resolved_by: null,
    resolution_note: null,
    resolved_at: null,
    ...overrides,
  };
}

function createQueueMock(): {
  add: ReturnType<typeof vi.fn<(name: string, data: { jobId: string }) => Promise<void>>>;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  return {
    add: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
}

function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    queue_name: QUEUE_INDEXING,
    type: 'reindex',
    priority: 100,
    status: 'pending',
    attempt_count: 0,
    max_attempts: 3,
    timeout_seconds: null,
    locked_by: null,
    locked_at: null,
    next_run_at: null,
    cancel_requested_at: null,
    payload_json: {},
    result_json: null,
    error_json: null,
    idempotency_key: null,
    created_by: TEST_USER_ID,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}
