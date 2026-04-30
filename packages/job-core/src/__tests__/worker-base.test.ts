import type { Job as BullMQJob } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobEventRepository } from '../event-repository.js';
import type { JobRow } from '../schema.js';
import { JobStateMachine } from '../state-machine.js';
import { JobStatus } from '../status.js';
import { AbstractBullMQWorker } from '../worker-base.js';
import { RedisMock, ScriptedDb, createJobRow } from './test-utils.js';

import { RedisJobLock } from '../lock.js';

class TestWorker extends AbstractBullMQWorker<{ jobId: string }, unknown> {
  processImpl: (job: JobRow, bullJob: BullMQJob<{ jobId: string }, unknown, string>) => Promise<unknown> = () =>
    Promise.resolve({ ok: true });

  protected process(
    job: JobRow,
    bullJob: BullMQJob<{ jobId: string }, unknown, string>,
  ): Promise<unknown> {
    return this.processImpl(job, bullJob);
  }
}

describe('AbstractBullMQWorker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts stack traces and truncates error messages in error_json', async () => {
    const db = new ScriptedDb().asDb();
    const worker = new TestWorker(db, new RedisMock(), 'worker-1');
    const error = new Error('x'.repeat(1_200)) as Error & { retryable: boolean };
    error.retryable = false;
    error.stack = 'sensitive stack trace';

    vi.spyOn(
      worker as unknown as {
        renewLock(jobId: string, ttlSeconds?: number): Promise<boolean>;
      },
      'renewLock',
    ).mockResolvedValue(true);

    const transitionSpy = vi
      .spyOn(JobStateMachine, 'transition')
      .mockResolvedValue(createJobRow({ status: JobStatus.FAILED }));
    vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);

    await invokeHandleFailure(worker, 'job-1', createJobRow({ id: 'job-1', status: JobStatus.RUNNING }), error);

    expect(transitionSpy).toHaveBeenCalledWith(
      db,
      'job-1',
      JobStatus.RUNNING,
      JobStatus.FAILED,
      expect.objectContaining({
        error_json: {
          name: 'Error',
          message: 'x'.repeat(1_000),
          retryable: false,
        },
      }),
    );
    expect(transitionSpy.mock.calls[0]?.[4]).toMatchObject({
      error_json: {
        name: 'Error',
        message: 'x'.repeat(1_000),
        retryable: false,
      },
    });
    expect((transitionSpy.mock.calls[0]?.[4] as { error_json?: Record<string, unknown> }).error_json).not.toHaveProperty(
      'stack',
    );
  });

  it('handles the full happy-path lifecycle: acquire → running → process → succeeded → release', async () => {
    const redis = new RedisMock();
    const db = new ScriptedDb();
    const worker = new TestWorker(db.asDb(), redis, 'worker-1');
    worker.processImpl = () => Promise.resolve({ output: 'done' });

    const runningJob = createJobRow({ id: 'job-hp', status: JobStatus.RUNNING, locked_by: 'worker-1' });
    const succeededJob = createJobRow({ id: 'job-hp', status: JobStatus.SUCCEEDED });

    const acquireSpy = vi.spyOn(RedisJobLock, 'acquire').mockResolvedValue(true);
    const renewSpy = vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    const releaseSpy = vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    const transitionSpy = vi
      .spyOn(JobStateMachine, 'transition')
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValueOnce(succeededJob);

    const eventSpy = vi
      .spyOn(JobEventRepository, 'create')
      .mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);

    const bullJob = { id: 'bull-1', data: { jobId: 'job-hp' } } as unknown as BullMQJob<{ jobId: string }, unknown, string>;
    const handleBullMQJob = (worker as unknown as { handleBullMQJob: (j: typeof bullJob) => Promise<unknown> }).handleBullMQJob.bind(worker);
    const result = await handleBullMQJob(bullJob);

    expect(result).toEqual({ output: 'done' });

    expect(acquireSpy).toHaveBeenCalledWith(redis, 'job-hp', 'worker-1', 600);

    expect(transitionSpy).toHaveBeenNthCalledWith(
      1,
      db.asDb(),
      'job-hp',
      JobStatus.PENDING,
      JobStatus.RUNNING,
      expect.objectContaining({ locked_by: 'worker-1' }),
    );

    expect(transitionSpy).toHaveBeenNthCalledWith(
      2,
      db.asDb(),
      'job-hp',
      JobStatus.RUNNING,
      JobStatus.SUCCEEDED,
      expect.objectContaining({ result_json: { output: 'done' }, locked_by: null }),
    );

    expect(eventSpy).toHaveBeenCalledTimes(2);
    const firstEventArg = eventSpy.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(firstEventArg).toMatchObject({
      event_type: 'status_changed',
      detail_json: { from: JobStatus.PENDING, to: JobStatus.RUNNING },
    });
    const secondEventArg = eventSpy.mock.calls[1]?.[1] as Record<string, unknown> | undefined;
    expect(secondEventArg).toMatchObject({
      event_type: 'status_changed',
      detail_json: { from: JobStatus.RUNNING, to: JobStatus.SUCCEEDED },
    });

    expect(renewSpy).toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalledWith(redis, 'job-hp', 'worker-1');
  });

  it('retries with exponential backoff when process fails and attempts remain', async () => {
    const redis = new RedisMock();
    const db = new ScriptedDb();
    const worker = new TestWorker(db.asDb(), redis, 'worker-1');
    const retryError = new Error('transient failure');
    worker.processImpl = () => Promise.reject(retryError);

    const runningJob = createJobRow({ id: 'job-retry', status: JobStatus.RUNNING, attempt_count: 0, max_attempts: 3 });
    const failedJob = createJobRow({ id: 'job-retry', status: JobStatus.FAILED, attempt_count: 1 });
    const retriedJob = createJobRow({ id: 'job-retry', status: JobStatus.PENDING, attempt_count: 1 });

    vi.spyOn(RedisJobLock, 'acquire').mockResolvedValue(true);
    vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
    vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);

    const transitionSpy = vi
      .spyOn(JobStateMachine, 'transition')
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValueOnce(failedJob)
      .mockResolvedValueOnce(retriedJob);

    const eventSpy = vi
      .spyOn(JobEventRepository, 'create')
      .mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);

    const bullJob = { id: 'bull-1', data: { jobId: 'job-retry' } } as unknown as BullMQJob<{ jobId: string }, unknown, string>;
    const handleBullMQJob = (worker as unknown as { handleBullMQJob: (j: typeof bullJob) => Promise<unknown> }).handleBullMQJob.bind(worker);

    await expect(handleBullMQJob(bullJob)).rejects.toThrow('transient failure');

    expect(transitionSpy).toHaveBeenNthCalledWith(
      1, db.asDb(), 'job-retry', JobStatus.PENDING, JobStatus.RUNNING, expect.any(Object),
    );
    expect(transitionSpy).toHaveBeenNthCalledWith(
      2, db.asDb(), 'job-retry', JobStatus.RUNNING, JobStatus.FAILED,
      expect.objectContaining({ attempt_count: 1, locked_by: null }),
    );
    const retryTransitionArgs = transitionSpy.mock.calls[2] as unknown[] | undefined;
    expect(retryTransitionArgs?.[2]).toBe(JobStatus.FAILED);
    expect(retryTransitionArgs?.[3]).toBe(JobStatus.PENDING);
    const retryUpdates = retryTransitionArgs?.[4] as Record<string, unknown> | undefined;
    expect(retryUpdates?.next_run_at).toBeInstanceOf(Date);
    expect(retryUpdates?.started_at).toBeNull();
    expect(retryUpdates?.completed_at).toBeNull();

    type EventArg = { detail_json?: { from?: string; to?: string } };
    const retryEvent = eventSpy.mock.calls.find((call) => {
      const arg = call[1] as EventArg | undefined;
      return arg?.detail_json?.from === JobStatus.FAILED && arg.detail_json.to === JobStatus.PENDING;
    });
    expect(retryEvent).toBeDefined();
  });

  it('persists a generic message for non-Error thrown values', async () => {
    const db = new ScriptedDb().asDb();
    const worker = new TestWorker(db, new RedisMock(), 'worker-1');

    vi.spyOn(
      worker as unknown as {
        renewLock(jobId: string, ttlSeconds?: number): Promise<boolean>;
      },
      'renewLock',
    ).mockResolvedValue(true);

    const transitionSpy = vi
      .spyOn(JobStateMachine, 'transition')
      .mockResolvedValue(createJobRow({ status: JobStatus.FAILED }));
    vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);

    await invokeHandleFailure(
      worker,
      'job-1',
      createJobRow({ id: 'job-1', status: JobStatus.RUNNING, attempt_count: 2, max_attempts: 3 }),
      'sensitive failure detail',
    );

    expect(transitionSpy).toHaveBeenCalledWith(
      db,
      'job-1',
      JobStatus.RUNNING,
      JobStatus.FAILED,
      expect.objectContaining({
        error_json: {
          message: 'Job processing failed',
        },
      }),
    );
  });
});

async function invokeHandleFailure(
  worker: AbstractBullMQWorker<{ jobId: string }>,
  jobId: string,
  job: JobRow,
  error: unknown,
): Promise<void> {
  const workerWithHandleFailure = worker as unknown as {
    handleFailure(jobId: string, job: JobRow, errorValue: unknown): Promise<void>;
  };

  await workerWithHandleFailure.handleFailure(jobId, job, error);
}
