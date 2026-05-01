import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JobEventRepository, JobRepository, JobStatus, RedisJobLock } from '@cherrygraph/job-core';

import { InternalJobsService } from '../../apps/api/src/internal/internal-jobs.service.js';
import { ExpiringRedisMock, InMemoryJobDb, TEST_TENANT_ID, TEST_USER_ID } from './stage2-integration-test-utils.js';

describe('Stage 2 worker lifecycle integration', () => {
  const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

  beforeEach(() => {
    process.env.DEFAULT_TENANT_ID = TEST_TENANT_ID;
  });

  afterEach(() => {
    if (originalDefaultTenantId === undefined) {
      delete process.env.DEFAULT_TENANT_ID;
    } else {
      process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
    }
  });

  it('runs poll -> lock -> progress -> complete and exposes the next pending job', async () => {
    const db = new InMemoryJobDb();
    const redis = new ExpiringRedisMock();
    const service = new InternalJobsService(db.asDb() as never, redis as never);

    const firstJob = await JobRepository.create(db.asDb(), {
      id: 'job-1',
      tenant_id: TEST_TENANT_ID,
      type: 'graphify',
      priority: 10,
      created_by: TEST_USER_ID,
      payload_json: { source_id: 'source-1' },
      created_at: new Date('2026-04-30T12:00:00.000Z'),
    });
    const secondJob = await JobRepository.create(db.asDb(), {
      id: 'job-2',
      tenant_id: TEST_TENANT_ID,
      type: 'graphify',
      priority: 20,
      created_by: TEST_USER_ID,
      payload_json: { source_id: 'source-2' },
      created_at: new Date('2026-04-30T12:01:00.000Z'),
    });

    const polled = await service.pollPendingJobs('graphify', 1);
    expect(polled).toMatchObject([
      {
        job_id: firstJob.id,
        status: JobStatus.PENDING,
      },
    ]);

    const running = await service.reportProgress(firstJob.id, {
      worker_id: 'worker-1',
      percent: 45,
      stage: 'chunking',
    });
    expect(running).toMatchObject({
      job_id: firstJob.id,
      status: JobStatus.RUNNING,
      progress: {
        percent: 45,
        stage: 'chunking',
      },
    });

    const completed = await service.reportComplete(firstJob.id, {
      worker_id: 'worker-1',
      result_json: { output: 'done' },
    });
    expect(completed).toMatchObject({
      job_id: firstJob.id,
      status: JobStatus.SUCCEEDED,
      result_json: { output: 'done' },
    });

    const events = await JobEventRepository.queryByJobId(db.asDb(), firstJob.id);
    expect(events.map((event) => event.event_type)).toEqual([
      'status_changed',
      'progress_updated',
      'status_changed',
    ]);
    expect(events[0]?.detail_json).toMatchObject({
      from: JobStatus.PENDING,
      to: JobStatus.RUNNING,
      worker_id: 'worker-1',
    });
    expect(events[1]?.detail_json).toEqual({
      percent: 45,
      stage: 'chunking',
    });
    expect(events[2]?.detail_json).toMatchObject({
      from: JobStatus.RUNNING,
      to: JobStatus.SUCCEEDED,
      worker_id: 'worker-1',
    });

    expect(db.getJob(firstJob.id)).toMatchObject({
      status: JobStatus.SUCCEEDED,
      locked_by: null,
      result_json: { output: 'done' },
    });
    expect(redis.has(RedisJobLock.key(firstJob.id))).toBe(false);

    const subsequentPoll = await service.pollPendingJobs('graphify', 1);
    expect(subsequentPoll).toMatchObject([
      {
        job_id: secondJob.id,
        status: JobStatus.PENDING,
      },
    ]);
  });
});
