import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobEventRepository } from '../event-repository.js';
import { RedisJobLock } from '../lock.js';
import { JobStateMachine } from '../state-machine.js';
import { JobStatus } from '../status.js';
import { TimeoutScanner } from '../timeout-scanner.js';
import { createJobRow, RedisMock, ScriptedDb } from './test-utils.js';

describe('TimeoutScanner', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('marks expired jobs as failed, records timeout events, and releases locks', async () => {
    const db = new ScriptedDb();
    const redis = new RedisMock();
    const expiredJob = createJobRow({
      id: 'job-expired',
      status: JobStatus.RUNNING,
      attempt_count: 2,
      max_attempts: 3,
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

  it('retries timed-out job when attempts remain', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    const db = new ScriptedDb();
    const redis = new RedisMock();
    const expiredJob = createJobRow({
      id: 'job-expired',
      status: JobStatus.RUNNING,
      attempt_count: 0,
      max_attempts: 3,
      locked_by: 'worker-1',
      locked_at: new Date('2026-04-30T11:30:00.000Z'),
      timeout_seconds: 300,
    });
    const nextRunAt = new Date('2026-04-30T12:01:00.000Z');

    db.queueSelect([expiredJob]);

    const transitionSpy = vi
      .spyOn(JobStateMachine, 'transition')
      .mockResolvedValueOnce(
        createJobRow({
          ...expiredJob,
          status: JobStatus.FAILED,
          attempt_count: 1,
          locked_by: null,
          locked_at: null,
          completed_at: new Date('2026-04-30T12:00:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        createJobRow({
          ...expiredJob,
          status: JobStatus.PENDING,
          attempt_count: 1,
          locked_by: null,
          locked_at: null,
          started_at: null,
          completed_at: null,
          next_run_at: nextRunAt,
        }),
      );
    const eventSpy = vi
      .spyOn(JobEventRepository, 'create')
      .mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
    const releaseSpy = vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    await expect(TimeoutScanner.scan(db.asDb(), redis)).resolves.toBe(1);

    expect(transitionSpy).toHaveBeenNthCalledWith(
      1,
      db,
      'job-expired',
      JobStatus.RUNNING,
      JobStatus.FAILED,
      expect.objectContaining({
        attempt_count: 1,
        error_json: { code: 'TIMEOUT', message: 'Job exceeded timeout' },
      }),
    );
    expect(transitionSpy).toHaveBeenNthCalledWith(
      2,
      db,
      'job-expired',
      JobStatus.FAILED,
      JobStatus.PENDING,
      expect.objectContaining({
        next_run_at: nextRunAt,
        started_at: null,
        completed_at: null,
      }),
    );
    const retryEvent = eventSpy.mock.calls
      .map(([, event]) => event)
      .find(
        (event) =>
          event.event_type === 'status_changed' &&
          isStatusChangedEventDetail(event.detail_json) &&
          event.detail_json.from === JobStatus.FAILED &&
          event.detail_json.to === JobStatus.PENDING,
      );

    expect(retryEvent).toBeDefined();
    if (retryEvent === undefined || !isStatusChangedEventDetail(retryEvent.detail_json)) {
      throw new Error('Expected timeout retry status_changed event');
    }
    expect(retryEvent.detail_json.reason).toBe('timeout_retry');
    expect(retryEvent.detail_json.next_run_at).toBe(nextRunAt.toISOString());
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

function isStatusChangedEventDetail(
  value: unknown,
): value is {
  from?: string;
  to?: string;
  reason?: string;
  next_run_at?: string;
} {
  return typeof value === 'object' && value !== null;
}
