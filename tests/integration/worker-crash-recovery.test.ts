import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobEventRepository, JobRepository, JobStatus, RedisJobLock, TimeoutScanner } from '@cherrygraph/job-core';

import { InternalJobsService } from '../../apps/api/src/internal/internal-jobs.service.js';
import { ExpiringRedisMock, InMemoryJobDb, TEST_TENANT_ID, TEST_USER_ID } from './stage2-integration-test-utils.js';

describe('Stage 2 worker crash recovery integration', () => {
  const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

  beforeEach(() => {
    process.env.DEFAULT_TENANT_ID = TEST_TENANT_ID;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalDefaultTenantId === undefined) {
      delete process.env.DEFAULT_TENANT_ID;
    } else {
      process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
    }
  });

  it('requeues a crashed job after timeout and lets another worker claim it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    const db = new InMemoryJobDb();
    const redis = new ExpiringRedisMock();
    const service = new InternalJobsService(db.asDb() as never, redis as never);

    await JobRepository.create(db.asDb(), {
      id: 'job-1',
      tenant_id: TEST_TENANT_ID,
      type: 'graphify',
      timeout_seconds: 30,
      max_attempts: 3,
      created_by: TEST_USER_ID,
      payload_json: { source_id: 'source-1' },
    });

    await expect(RedisJobLock.acquire(redis, 'job-1', 'worker-1', 600)).resolves.toBe(true);
    await service.reportProgress('job-1', {
      worker_id: 'worker-1',
      percent: 10,
      stage: 'fetching',
    });

    vi.advanceTimersByTime(31_000);

    await expect(TimeoutScanner.scan(db.asDb(), redis)).resolves.toBe(1);
    expect(db.getJob('job-1')).toMatchObject({
      status: JobStatus.PENDING,
      attempt_count: 1,
      locked_by: null,
      locked_at: null,
    });
    expect(redis.has(RedisJobLock.key('job-1'))).toBe(false);

    const recoveryEvents = await JobEventRepository.queryByJobId(db.asDb(), 'job-1');
    expect(recoveryEvents.map((event) => event.event_type)).toEqual([
      'status_changed',
      'progress_updated',
      'status_changed',
      'status_changed',
      'timeout_detected',
    ]);
    expect(recoveryEvents[2]?.detail_json).toMatchObject({
      from: JobStatus.RUNNING,
      to: JobStatus.FAILED,
      reason: 'timeout',
    });
    expect(recoveryEvents[3]?.detail_json).toMatchObject({
      from: JobStatus.FAILED,
      to: JobStatus.PENDING,
      reason: 'timeout_retry',
    });

    vi.advanceTimersByTime(60_000);

    const polled = await service.pollPendingJobs('graphify', 1);
    expect(polled).toMatchObject([
      {
        job_id: 'job-1',
        status: JobStatus.PENDING,
      },
    ]);

    await expect(RedisJobLock.acquire(redis, 'job-1', 'worker-2', 600)).resolves.toBe(true);
    const reactivated = await service.reportProgress('job-1', {
      worker_id: 'worker-2',
      percent: 5,
      stage: 'retrying',
    });

    expect(reactivated).toMatchObject({
      job_id: 'job-1',
      status: JobStatus.RUNNING,
      progress: {
        percent: 5,
        stage: 'retrying',
      },
    });
    expect(db.getJob('job-1')).toMatchObject({
      status: JobStatus.RUNNING,
      locked_by: 'worker-2',
      attempt_count: 1,
    });
  });
});
