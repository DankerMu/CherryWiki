import type { Job as BullMQJob } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobEventRepository } from '../event-repository.js';
import type { JobRow } from '../schema.js';
import { JobStateMachine } from '../state-machine.js';
import { JobStatus } from '../status.js';
import { AbstractBullMQWorker } from '../worker-base.js';
import { RedisMock, ScriptedDb, createJobRow } from './test-utils.js';

class TestWorker extends AbstractBullMQWorker<{ jobId: string }> {
  protected process(
    _job: JobRow,
    _bullJob: BullMQJob<{ jobId: string }, unknown, string>,
  ): Promise<unknown> {
    void _job;
    void _bullJob;
    return Promise.resolve(null);
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
