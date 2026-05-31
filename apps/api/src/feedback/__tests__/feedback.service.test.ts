import { HttpException } from '@nestjs/common';
import {
  JobRepository,
  QueueFactory,
  QUEUE_INDEXING,
  type JobRow,
} from '@cherrygraph/job-core';
import { ErrorCode, feedbackItems, type FeedbackType } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditEntry } from '../../audit/audit.service.js';
import {
  ScriptedDb,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
  getHttpExceptionCode,
  getHttpExceptionResponse,
  getRejectedHttpException,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { FeedbackService } from '../feedback.service.js';

describe('FeedbackService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates feedback with a message_id target', async () => {
    const { service, db, audit } = createServiceContext();

    const result = await service.createFeedback(
      {
        feedback_type: 'incorrect',
        message_id: 'message-1',
        payload_json: { description: 'Citation is wrong' },
      },
      createContext(),
    );

    expect(db.inserts[0]?.table).toBe(feedbackItems);
    expect(db.inserts[0]?.value).toMatchObject({
      tenant_id: TEST_TENANT_ID,
      user_id: TEST_USER_ID,
      space_id: TEST_SPACE_ID,
      message_id: 'message-1',
      feedback_type: 'incorrect',
      status: 'open',
      payload_json: { description: 'Citation is wrong' },
    });
    expect(result).toMatchObject({
      tenant_id: TEST_TENANT_ID,
      user_id: TEST_USER_ID,
      message_id: 'message-1',
      status: 'open',
    });
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'feedback.created',
        resource_type: 'feedback_item',
        resource_id: result.id,
        space_id: TEST_SPACE_ID,
      }) as AuditEntry,
    );
  });

  it('creates feedback with a payload_json.page_id target', async () => {
    const { service, db } = createServiceContext();

    await service.createFeedback(
      {
        feedback_type: 'outdated',
        payload_json: { page_id: 'page-1', description: 'Content is stale' },
      },
      createContext(),
    );

    expect(db.inserts[0]?.value).toMatchObject({
      message_id: null,
      feedback_type: 'outdated',
      payload_json: { page_id: 'page-1', description: 'Content is stale' },
    });
  });

  it('rejects feedback without a message_id or payload_json.page_id target', async () => {
    const { service } = createServiceContext();

    const err = await getRejectedHttpException(
      service.createFeedback(
        {
          feedback_type: 'missing',
          payload_json: { description: 'No target' },
        },
        createContext(),
      ),
    );

    expect(err.getStatus()).toBe(400);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.FEEDBACK_TARGET_REQUIRED);
  });

  it('validates feedback_type using the shared schema', async () => {
    const { service } = createServiceContext();

    const err = await getRejectedHttpException(
      service.createFeedback(
        {
          feedback_type: 'conflict',
          message_id: 'message-1',
          payload_json: {},
        },
        createContext(),
      ),
    );

    expect(err.getStatus()).toBe(422);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.VALIDATION_ERROR);
    expect(getHttpExceptionResponse(err)).toMatchObject({
      message: 'Validation failed',
      details: expect.arrayContaining([
        expect.objectContaining({ path: 'feedback_type' }),
      ]) as unknown[],
    });
  });

  it('resolves open feedback and writes the resolution note', async () => {
    const { service, db, audit } = createServiceContext();
    const feedback = createFeedbackRow({
      payload_json: { page_id: 'page-1' },
      created_at: new Date('2026-05-01T10:00:00.000Z'),
    });
    const resolved = createFeedbackRow({
      ...feedback,
      status: 'resolved',
      resolved_by: TEST_USER_ID,
      resolved_at: new Date('2026-05-02T10:00:00.000Z'),
      resolution_note: 'accepted: Page updated',
    });
    db.queueSelect([feedback]);
    db.queueUpdate([resolved]);
    db.queueSelect([
      {
        id: 'wiki-page-pk-1',
        page_id: 'page-1',
        space_id: TEST_SPACE_ID,
        updated_at: new Date('2026-05-01T09:00:00.000Z'),
      },
    ]);

    const result = await service.resolveFeedback('feedback-1', { resolution: 'accepted', notes: 'Page updated' }, createContext());

    expect(result).toMatchObject({
      id: 'feedback-1',
      status: 'resolved',
      resolution_note: 'accepted: Page updated',
      resolved_by: TEST_USER_ID,
    });
    expect(db.updates[0]?.value).toMatchObject({
      status: 'resolved',
      resolved_by: TEST_USER_ID,
      resolution_note: 'accepted: Page updated',
    });
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'feedback.resolved',
        resource_type: 'feedback_item',
        resource_id: 'feedback-1',
      }) as AuditEntry,
    );
  });

  it('rejects duplicate resolve attempts with 409', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createFeedbackRow({ status: 'resolved', resolved_at: new Date('2026-05-02T00:00:00.000Z') })]);

    try {
      await service.resolveFeedback('feedback-1', { resolution: 'duplicate' }, createContext());
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(409);
      expect(getHttpExceptionCode(err)).toBe(ErrorCode.FEEDBACK_ALREADY_RESOLVED);
      return;
    }

    throw new Error('Expected duplicate resolve to reject');
  });

  it('triggers a reindex job when the associated page changed after feedback creation', async () => {
    const { service, db } = createServiceContext({ redis: {} as never });
    const queue = createQueueMock();
    const job = createJobRow({ id: 'job-feedback-reindex' });
    const createJobSpy = vi.spyOn(JobRepository, 'create').mockResolvedValue(job);
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(queue as never);
    const feedback = createFeedbackRow({
      payload_json: { page_id: 'page-1' },
      created_at: new Date('2026-05-01T10:00:00.000Z'),
    });
    db.queueSelect([feedback]);
    db.queueUpdate([createFeedbackRow({ ...feedback, status: 'resolved', resolution_note: 'accepted: Fixed' })]);
    db.queueSelect([
      {
        id: 'wiki-page-pk-1',
        page_id: 'page-1',
        space_id: TEST_SPACE_ID,
        updated_at: new Date('2026-05-01T11:00:00.000Z'),
      },
    ]);

    await service.resolveFeedback('feedback-1', { resolution: 'accepted', notes: 'Fixed' }, createContext());

    expect(createJobSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        space_id: TEST_SPACE_ID,
        queue_name: QUEUE_INDEXING,
        type: 'reindex',
        payload_json: expect.objectContaining({
          trigger: 'feedback_resolved',
          scope: 'single_page',
          page_id: 'page-1',
          feedback_id: 'feedback-1',
        }) as unknown,
        created_by: TEST_USER_ID,
      }),
    );
    expect(queue.add).toHaveBeenCalledWith('reindex', { jobId: 'job-feedback-reindex' });
    expect(queue.close).toHaveBeenCalledTimes(1);
  });
});

function createServiceContext(options: { redis?: never } = {}): {
  service: FeedbackService;
  db: ScriptedDb;
  audit: ReturnType<typeof createAuditMock>;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  const service = new FeedbackService(db.asDrizzle(), audit.service, options.redis);
  return { service, db, audit };
}

function createContext(): {
  tenantId: string;
  actorUserId: string;
  spaceId: string;
} {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_USER_ID,
    spaceId: TEST_SPACE_ID,
  };
}

function createFeedbackRow(overrides: Partial<typeof feedbackItems.$inferSelect> = {}): typeof feedbackItems.$inferSelect {
  return {
    id: 'feedback-1',
    tenant_id: TEST_TENANT_ID,
    user_id: TEST_USER_ID,
    message_id: null,
    space_id: TEST_SPACE_ID,
    feedback_type: 'incorrect' satisfies FeedbackType,
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
