import { describe, expect, it } from 'vitest';

import { JobEventRepository, JobRepository, JobStatus } from '@cherrygraph/job-core';

import { JobsService, type JobContext } from '../../apps/api/src/jobs/jobs.service.js';
import { InMemoryJobDb, TEST_TENANT_ID, TEST_USER_ID } from './stage2-integration-test-utils.js';

describe('Stage 2 job cancel integration', () => {
  it('cancels a pending job directly and records status_changed', async () => {
    const db = new InMemoryJobDb();
    const service = new JobsService(db.asDb() as never);

    await JobRepository.create(db.asDb(), {
      id: 'job-pending',
      tenant_id: TEST_TENANT_ID,
      type: 'graphify',
      status: JobStatus.PENDING,
      created_by: TEST_USER_ID,
    });

    const result = await service.cancelJob('job-pending', createCreatorContext());

    expect(result).toEqual({
      job_id: 'job-pending',
      status: JobStatus.CANCELLED,
      cancel_requested_at: null,
    });
    expect(db.getJob('job-pending')).toMatchObject({
      status: JobStatus.CANCELLED,
    });

    const events = await JobEventRepository.queryByJobId(db.asDb(), 'job-pending');
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('status_changed');
    expect(events[0]?.detail_json).toMatchObject({
      from: JobStatus.PENDING,
      to: JobStatus.CANCELLED,
      requested_by: TEST_USER_ID,
    });
  });

  it('sets cancel_requested_at for a running job and records cancel_requested', async () => {
    const db = new InMemoryJobDb();
    const service = new JobsService(db.asDb() as never);

    await JobRepository.create(db.asDb(), {
      id: 'job-running',
      tenant_id: TEST_TENANT_ID,
      type: 'graphify',
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T12:00:00.000Z'),
      started_at: new Date('2026-04-30T12:00:00.000Z'),
      created_by: TEST_USER_ID,
    });

    const result = await service.cancelJob('job-running', createCreatorContext());

    expect(result.job_id).toBe('job-running');
    expect(result.status).toBe(JobStatus.RUNNING);
    expect(result.cancel_requested_at).toBeInstanceOf(Date);
    expect(db.getJob('job-running')?.cancel_requested_at).toBeInstanceOf(Date);

    const events = await JobEventRepository.queryByJobId(db.asDb(), 'job-running');
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('cancel_requested');
    expect(events[0]?.detail_json).toMatchObject({
      requested_by: TEST_USER_ID,
    });
  });

  it('treats repeated cancel on an already requested running job as idempotent', async () => {
    const db = new InMemoryJobDb();
    const service = new JobsService(db.asDb() as never);
    const cancelRequestedAt = new Date('2026-04-30T12:05:00.000Z');

    await JobRepository.create(db.asDb(), {
      id: 'job-running',
      tenant_id: TEST_TENANT_ID,
      type: 'graphify',
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T12:00:00.000Z'),
      started_at: new Date('2026-04-30T12:00:00.000Z'),
      cancel_requested_at: cancelRequestedAt,
      created_by: TEST_USER_ID,
    });

    const result = await service.cancelJob('job-running', createCreatorContext());

    expect(result).toEqual({
      job_id: 'job-running',
      status: JobStatus.RUNNING,
      cancel_requested_at: cancelRequestedAt,
    });
    expect(await JobEventRepository.queryByJobId(db.asDb(), 'job-running')).toEqual([]);
  });
});

function createCreatorContext(): JobContext {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_USER_ID,
    userId: TEST_USER_ID,
    actorRole: 'viewer',
  };
}
