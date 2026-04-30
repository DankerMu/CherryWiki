import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobEventRepository, JobRepository, JobStateMachine, JobStatus, RedisJobLock } from '@cherrygraph/job-core';

import { InternalJobsService } from '../../apps/api/src/internal/internal-jobs.service.js';
import { ExpiringRedisMock, InMemoryJobDb, TEST_TENANT_ID, TEST_USER_ID } from './stage2-integration-test-utils.js';

describe('Stage 2 worker heartbeat integration', () => {
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

  it('marks a worker dead after 3 missed intervals and releases its locks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    const db = new InMemoryJobDb();
    const redis = new ExpiringRedisMock();
    const service = new InternalJobsService(db.asDb() as never, redis as never);

    await JobRepository.create(db.asDb(), {
      id: 'job-1',
      tenant_id: TEST_TENANT_ID,
      type: 'graphify',
      max_attempts: 3,
      created_by: TEST_USER_ID,
    });
    await expect(RedisJobLock.acquire(redis, 'job-1', 'worker-1', 600)).resolves.toBe(true);
    await JobStateMachine.transition(db.asDb(), 'job-1', JobStatus.PENDING, JobStatus.RUNNING, {
      locked_by: 'worker-1',
      locked_at: new Date(),
      started_at: new Date(),
    });

    await expect(
      service.recordHeartbeat({
        worker_id: 'worker-1',
        active_jobs: ['job-1'],
        system_info: { cpu_percent: 12 },
      }),
    ).resolves.toEqual({
      ack: true,
      cancel_requested: [],
      lost_locks: [],
    });

    vi.advanceTimersByTime(30_000);
    await expect(
      service.recordHeartbeat({
        worker_id: 'worker-1',
        active_jobs: ['job-1'],
        system_info: { cpu_percent: 15 },
      }),
    ).resolves.toEqual({
      ack: true,
      cancel_requested: [],
      lost_locks: [],
    });

    vi.advanceTimersByTime(91_000);

    await expect(service.scanDeadWorkers()).resolves.toBe(1);
    expect(db.getJob('job-1')).toMatchObject({
      status: JobStatus.PENDING,
      attempt_count: 1,
      locked_by: null,
      locked_at: null,
    });
    expect(redis.has(RedisJobLock.key('job-1'))).toBe(false);

    const events = await JobEventRepository.queryByJobId(db.asDb(), 'job-1');
    expect(events.map((event) => event.event_type)).toEqual([
      'status_changed',
      'status_changed',
      'timeout_detected',
    ]);
    expect(events[0]?.detail_json).toMatchObject({
      from: JobStatus.RUNNING,
      to: JobStatus.FAILED,
      worker_id: 'worker-1',
      reason: 'worker_timeout',
    });
    expect(events[1]?.detail_json).toMatchObject({
      from: JobStatus.FAILED,
      to: JobStatus.PENDING,
      worker_id: 'worker-1',
      reason: 'worker_timeout_retry',
    });
    expect(events[2]?.detail_json).toMatchObject({
      worker_id: 'worker-1',
      reason: 'worker_missed_heartbeat',
    });
  });
});
