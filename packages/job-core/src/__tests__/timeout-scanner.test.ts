import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobEventRepository } from '../event-repository.js';
import { RedisJobLock } from '../lock.js';
import { JobStateMachine } from '../state-machine.js';
import { JobStatus } from '../status.js';
import { TimeoutScanner } from '../timeout-scanner.js';
import { createJobRow, RedisMock, ScriptedDb } from './test-utils.js';

describe('TimeoutScanner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks expired jobs as failed, records timeout events, and releases locks', async () => {
    const db = new ScriptedDb();
    const redis = new RedisMock();
    const expiredJob = createJobRow({
      id: 'job-expired',
      status: JobStatus.RUNNING,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-01T00:00:00.000Z'),
      timeout_seconds: 300,
    });

    db.queueSelect([expiredJob]);

    const transitionSpy = vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(
      createJobRow({
        ...expiredJob,
        status: JobStatus.FAILED,
        locked_by: null,
        locked_at: null,
      }),
    );
    const eventSpy = vi
      .spyOn(JobEventRepository, 'create')
      .mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    const releaseSpy = vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    await expect(TimeoutScanner.scan(db.asDb(), redis)).resolves.toBe(1);

    expect(transitionSpy).toHaveBeenCalledWith(
      db,
      'job-expired',
      JobStatus.RUNNING,
      JobStatus.FAILED,
      expect.objectContaining({
        attempt_count: expiredJob.attempt_count + 1,
        error_json: { code: 'TIMEOUT', message: 'Job exceeded timeout' },
      }),
    );
    expect(eventSpy).toHaveBeenCalledTimes(2);
    expect(eventSpy).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        job_id: 'job-expired',
        event_type: 'timeout_detected',
      }),
    );
    expect(releaseSpy).toHaveBeenCalledWith(redis, 'job-expired', 'worker-1');
  });

  it('skips non-expired running jobs', async () => {
    const db = new ScriptedDb();
    const redis = new RedisMock();
    db.queueSelect([]);

    const transitionSpy = vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(createJobRow());
    const eventSpy = vi
      .spyOn(JobEventRepository, 'create')
      .mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    const releaseSpy = vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    await expect(TimeoutScanner.scan(db.asDb(), redis)).resolves.toBe(0);

    expect(transitionSpy).not.toHaveBeenCalled();
    expect(eventSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
  });
});
