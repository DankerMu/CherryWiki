import { ErrorCode } from '@cherrygraph/shared';
import { JobRepository, JobStatus, type JobRow } from '@cherrygraph/job-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  ScriptedDb,
  getHttpExceptionCode,
  getRejectedHttpException,
  requireRecord,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { AdminJobListQueryDto, JobEventsQueryDto } from '../jobs.dto.js';
import { JobsService, type JobContext } from '../jobs.service.js';

describe('JobsService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns full job details for the creator', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createJobRow()]);
    db.queueSelect([createJobEventRow({ event_type: 'progress_updated', detail_json: { percent: 65, stage: 'chunking' } })]);

    const result = await service.getJob('job-1', createCreatorContext());

    expect(result).toMatchObject({
      job_id: 'job-1',
      type: 'graphify',
      status: JobStatus.PENDING,
      space_id: TEST_SPACE_ID,
      created_by: TEST_USER_ID,
      progress: {
        percent: 65,
        stage: 'chunking',
      },
      payload_json: { source_id: 'source-1' },
    });
  });

  it('returns 404 for a non-creator without space access', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createJobRow({ created_by: 'creator-2' })]);
    db.queueSelect([]);

    const err = await getRejectedHttpException(service.getJob('job-1', createViewerContext()));

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.NOT_FOUND);
  });

  it('returns the job event timeline in chronological order', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createJobRow()]);
    db.queueSelect([
      createJobEventRow({
        id: 'event-1',
        event_type: 'status_changed',
        detail_json: { from: 'pending', to: 'running' },
        created_at: new Date('2026-04-10T00:00:00.000Z'),
      }),
      createJobEventRow({
        id: 'event-2',
        event_type: 'progress_updated',
        detail_json: { percent: 35, stage: 'chunking' },
        created_at: new Date('2026-04-10T00:01:00.000Z'),
      }),
    ]);

    const result = await service.getJobEvents('job-1', createCreatorContext());

    expect(result).toEqual([
      {
        event: 'status_changed',
        timestamp: new Date('2026-04-10T00:00:00.000Z'),
        detail: { from: 'pending', to: 'running' },
      },
      {
        event: 'progress_updated',
        timestamp: new Date('2026-04-10T00:01:00.000Z'),
        detail: { percent: 35, stage: 'chunking' },
      },
    ]);
  });

  it('auditor with admin:audit_view can access job detail and events', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createJobRow({ created_by: 'creator-2' })]);
    db.queueSelect([]);
    db.queueSelect([createJobRow({ created_by: 'creator-2' })]);
    db.queueSelect([
      createJobEventRow({
        id: 'event-1',
        event_type: 'status_changed',
        detail_json: { from: 'pending', to: 'running' },
      }),
    ]);

    const context = createAuditContext();
    const job = await service.getJob('job-1', context);
    const events = await service.getJobEvents('job-1', context);

    expect(job).toMatchObject({
      job_id: 'job-1',
      created_by: 'creator-2',
      status: JobStatus.PENDING,
    });
    expect(events).toEqual([
      {
        event: 'status_changed',
        timestamp: new Date('2026-04-10T00:00:00.000Z'),
        detail: { from: 'pending', to: 'running' },
      },
    ]);
  });

  it('cancels a pending job immediately', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createJobRow({ status: JobStatus.PENDING })]);
    db.queueUpdate([
      createJobRow({
        status: JobStatus.CANCELLED,
        completed_at: new Date('2026-04-10T02:00:00.000Z'),
      }),
    ]);

    const result = await service.cancelJob('job-1', createCreatorContext());

    expect(result.job_id).toBe('job-1');
    expect(result.status).toBe(JobStatus.CANCELLED);
    expect(result.cancel_requested_at).toBeNull();

    const updateValue = requireRecord(db.updates[0]?.value);
    expect(updateValue.status).toBe(JobStatus.CANCELLED);
    expect(updateValue.completed_at).toBeInstanceOf(Date);

    const eventValue = requireRecord(db.inserts[0]?.value);
    expect(eventValue).toMatchObject({
      job_id: 'job-1',
      event_type: 'status_changed',
    });
  });

  it('sets cancel_requested_at for a running job', async () => {
    const { service, db } = createServiceContext();
    const cancelRequestedAt = new Date('2026-04-10T03:00:00.000Z');
    db.queueSelect([createJobRow({ status: JobStatus.RUNNING, started_at: new Date('2026-04-10T02:00:00.000Z') })]);
    db.queueUpdate([
      createJobRow({
        status: JobStatus.RUNNING,
        cancel_requested_at: cancelRequestedAt,
        started_at: new Date('2026-04-10T02:00:00.000Z'),
      }),
    ]);

    const result = await service.cancelJob('job-1', createCreatorContext());

    expect(result).toEqual({
      job_id: 'job-1',
      status: JobStatus.RUNNING,
      cancel_requested_at: cancelRequestedAt,
    });

    const updateValue = requireRecord(db.updates[0]?.value);
    expect(updateValue.cancel_requested_at).toBeInstanceOf(Date);

    const eventValue = requireRecord(db.inserts[0]?.value);
    expect(eventValue).toMatchObject({
      job_id: 'job-1',
      event_type: 'cancel_requested',
    });
  });

  it('cancel retries when job transitions pending->running during cancel attempt', async () => {
    const { service, db } = createServiceContext();
    const cancelRequestedAt = new Date('2026-04-10T03:00:00.000Z');
    db.queueSelect([createJobRow({ status: JobStatus.PENDING })]);
    db.queueUpdate([]);
    db.queueSelect([
      createJobRow({
        status: JobStatus.RUNNING,
        started_at: new Date('2026-04-10T02:00:00.000Z'),
      }),
    ]);
    db.queueSelect([
      createJobRow({
        status: JobStatus.RUNNING,
        started_at: new Date('2026-04-10T02:00:00.000Z'),
      }),
    ]);
    db.queueSelect([
      createJobRow({
        status: JobStatus.RUNNING,
        started_at: new Date('2026-04-10T02:00:00.000Z'),
      }),
    ]);
    db.queueUpdate([
      createJobRow({
        status: JobStatus.RUNNING,
        cancel_requested_at: cancelRequestedAt,
        started_at: new Date('2026-04-10T02:00:00.000Z'),
      }),
    ]);

    const result = await service.cancelJob('job-1', createCreatorContext());

    expect(result).toEqual({
      job_id: 'job-1',
      status: JobStatus.RUNNING,
      cancel_requested_at: cancelRequestedAt,
    });
    expect(db.updates).toHaveLength(2);
    expect(requireRecord(db.updates[0]?.value)).toMatchObject({
      status: JobStatus.CANCELLED,
    });
    expect(requireRecord(db.updates[1]?.value).cancel_requested_at).toBeInstanceOf(Date);
    expect(db.inserts).toHaveLength(1);
    expect(requireRecord(db.inserts[0]?.value)).toMatchObject({
      job_id: 'job-1',
      event_type: 'cancel_requested',
    });
  });

  it('returns current state when cancelling an already cancelled job', async () => {
    const { service, db } = createServiceContext();
    const completedAt = new Date('2026-04-10T04:00:00.000Z');
    db.queueSelect([
      createJobRow({
        status: JobStatus.CANCELLED,
        completed_at: completedAt,
      }),
    ]);

    await expect(service.cancelJob('job-1', createCreatorContext())).resolves.toEqual({
      job_id: 'job-1',
      status: JobStatus.CANCELLED,
      cancel_requested_at: null,
    });
    expect(db.updates).toHaveLength(0);
  });

  it.each([JobStatus.SUCCEEDED, JobStatus.FAILED] as const)(
    'returns 409 when cancelling a %s job',
    async (status) => {
      const { service, db } = createServiceContext();
      db.queueSelect([createJobRow({ status })]);

      const err = await getRejectedHttpException(service.cancelJob('job-1', createCreatorContext()));

      expect(err.getStatus()).toBe(409);
      expect(getHttpExceptionCode(err)).toBe(ErrorCode.CONFLICT);
    },
  );

  it('applies pagination when fetching job events', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createJobRow()]);
    db.queueSelect([createJobEventRow()]);

    const query = Object.assign(new JobEventsQueryDto(), {
      limit: 25,
      offset: 10,
    });
    await service.getJobEvents('job-1', createCreatorContext(), query);

    expect(db.limitCalls).toContain(25);
    expect(db.offsetCalls).toEqual([10]);
  });

  it('lists admin jobs with filters and pagination', async () => {
    const { service, db } = createServiceContext();
    const findByFilterSpy = vi.spyOn(JobRepository, 'findByFilter').mockResolvedValue({
      items: [createJobRow({ status: JobStatus.RUNNING })],
      total: 1,
      page: 2,
      perPage: 5,
    });
    db.queueSelect([
      createJobEventRow({
        event_type: 'progress_updated',
        detail_json: { percent: 80, stage: 'embedding' },
      }),
    ]);

    const query = Object.assign(new AdminJobListQueryDto(), {
      page: 2,
      per_page: 5,
      sort: '-created_at',
      type: 'graphify' as const,
      status: JobStatus.RUNNING,
      space_id: TEST_SPACE_ID,
    });
    const result = await service.listAdminJobs(query, createAdminContext());

    expect(findByFilterSpy).toHaveBeenCalledWith(
      db.asDrizzle(),
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        type: 'graphify',
        status: JobStatus.RUNNING,
        space_id: TEST_SPACE_ID,
        page: 2,
        perPage: 5,
        sort: {
          field: 'created_at',
          direction: 'desc',
        },
      }),
    );
    expect(result.data).toMatchObject([
      {
        job_id: 'job-1',
        status: JobStatus.RUNNING,
        progress: {
          percent: 80,
          stage: 'embedding',
        },
      },
    ]);
    expect(result.pagination).toEqual({
      page: 2,
      per_page: 5,
      total: 1,
      has_next: false,
    });
  });
});

function createServiceContext(): { service: JobsService; db: ScriptedDb } {
  const db = new ScriptedDb();
  const service = new JobsService(db.asDrizzle());

  return { service, db };
}

function createCreatorContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_USER_ID,
    userId: TEST_USER_ID,
    actorRole: 'viewer',
    ...overrides,
  };
}

function createViewerContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: 'viewer-2',
    userId: 'viewer-2',
    actorRole: 'viewer',
    ...overrides,
  };
}

function createAdminContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: 'admin-1',
    userId: 'admin-1',
    actorRole: 'admin',
    ...overrides,
  };
}

function createAuditContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: 'auditor-1',
    userId: 'auditor-1',
    actorRole: 'auditor',
    actorPermissions: ['admin:audit_view'],
    ...overrides,
  };
}

function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    queue_name: 'ingestion',
    type: 'graphify',
    priority: 100,
    status: JobStatus.PENDING,
    attempt_count: 0,
    max_attempts: 3,
    timeout_seconds: 600,
    locked_by: null,
    locked_at: null,
    next_run_at: null,
    cancel_requested_at: null,
    payload_json: { source_id: 'source-1' },
    result_json: null,
    error_json: null,
    idempotency_key: null,
    created_by: TEST_USER_ID,
    created_at: new Date('2026-04-10T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

function createJobEventRow(
  overrides: Partial<{
    id: string;
    job_id: string;
    event_type: string;
    detail_json: unknown;
    created_at: Date;
  }> = {},
): {
  id: string;
  job_id: string;
  event_type: string;
  detail_json: unknown;
  created_at: Date;
} {
  return {
    id: 'event-1',
    job_id: 'job-1',
    event_type: 'status_changed',
    detail_json: {},
    created_at: new Date('2026-04-10T00:00:00.000Z'),
    ...overrides,
  };
}
