import type { Job as BullMQJob, Worker, WorkerOptions } from 'bullmq';

import { JobEventRepository } from './event-repository.js';
import { RedisJobLock, type RedisJobLockClient } from './lock.js';
import { QueueFactory, type BullMQConnection } from './queue-factory.js';
import type { JobDatabase } from './repository.js';
import type { JobRow } from './schema.js';
import { JobConflictError, JobStateMachine } from './state-machine.js';
import { JobStatus } from './status.js';

type BullMQJobPayload = {
  jobId?: string;
};

export abstract class AbstractBullMQWorker<
  Payload extends BullMQJobPayload = BullMQJobPayload,
  Result = unknown,
  NameType extends string = string,
> {
  constructor(
    protected readonly db: JobDatabase,
    protected readonly redis: RedisJobLockClient,
    protected readonly workerId: string,
    protected readonly lockTtlSeconds = 600,
  ) {}

  createWorker(
    queueName: string,
    connection: BullMQConnection,
    opts: Omit<WorkerOptions, 'connection'> = {},
  ): Worker<Payload, Result, NameType> {
    return QueueFactory.createWorker<Payload, Result, NameType>(
      queueName,
      this.handleBullMQJob.bind(this),
      connection,
      opts,
    );
  }

  protected abstract process(job: JobRow, bullJob: BullMQJob<Payload, Result, NameType>): Promise<Result>;

  protected isRetryable(error: unknown): boolean {
    return !isRetryableFlag(error) || error.retryable !== false;
  }

  protected getRetryDelaySeconds(nextAttemptCount: number): number {
    return Math.min(60 * 2 ** Math.max(0, nextAttemptCount - 1), 1_800);
  }

  protected renewLock(jobId: string, ttlSeconds = this.lockTtlSeconds): Promise<boolean> {
    return RedisJobLock.renew(this.redis, jobId, this.workerId, ttlSeconds);
  }

  protected async recordProgress(jobId: string, detail: Record<string, unknown>): Promise<void> {
    await JobEventRepository.create(this.db, {
      job_id: jobId,
      event_type: 'progress_updated',
      detail_json: detail,
    });
  }

  private async handleBullMQJob(bullJob: BullMQJob<Payload, Result, NameType>): Promise<Result> {
    const jobId = resolveJobId(bullJob);
    const lockAcquired = await RedisJobLock.acquire(this.redis, jobId, this.workerId, this.lockTtlSeconds);
    if (!lockAcquired) {
      throw new JobConflictError(`Job ${jobId} is already locked by another worker`);
    }

    try {
      const startedAt = new Date();
      const runningJob = await JobStateMachine.transition(
        this.db,
        jobId,
        JobStatus.PENDING,
        JobStatus.RUNNING,
        {
          locked_by: this.workerId,
          locked_at: startedAt,
          started_at: startedAt,
          completed_at: null,
          error_json: null,
          result_json: null,
        },
      );

      await JobEventRepository.create(this.db, {
        job_id: jobId,
        event_type: 'status_changed',
        detail_json: {
          from: JobStatus.PENDING,
          to: JobStatus.RUNNING,
          worker_id: this.workerId,
        },
      });

      try {
        const result = await this.process(runningJob, bullJob);

        if (!(await this.renewLock(jobId))) {
          throw new JobConflictError(`Job ${jobId} lock was lost before completion`);
        }

        const completedAt = new Date();
        await JobStateMachine.transition(this.db, jobId, JobStatus.RUNNING, JobStatus.SUCCEEDED, {
          result_json: result,
          error_json: null,
          locked_by: null,
          locked_at: null,
          completed_at: completedAt,
        });

        await JobEventRepository.create(this.db, {
          job_id: jobId,
          event_type: 'status_changed',
          detail_json: {
            from: JobStatus.RUNNING,
            to: JobStatus.SUCCEEDED,
            worker_id: this.workerId,
          },
        });

        return result;
      } catch (error) {
        await this.handleFailure(jobId, runningJob, error);
        throw error;
      }
    } finally {
      await RedisJobLock.release(this.redis, jobId, this.workerId);
    }
  }

  private async handleFailure(jobId: string, job: JobRow, error: unknown): Promise<void> {
    if (!(await this.renewLock(jobId))) {
      return;
    }

    const nextAttemptCount = job.attempt_count + 1;
    const retryable = this.isRetryable(error) && nextAttemptCount < job.max_attempts;
    const failedAt = new Date();

    await JobStateMachine.transition(this.db, jobId, JobStatus.RUNNING, JobStatus.FAILED, {
      attempt_count: nextAttemptCount,
      error_json: normalizeError(error),
      locked_by: null,
      locked_at: null,
      completed_at: failedAt,
    });

    await JobEventRepository.create(this.db, {
      job_id: jobId,
      event_type: 'status_changed',
      detail_json: {
        from: JobStatus.RUNNING,
        to: JobStatus.FAILED,
        worker_id: this.workerId,
        retryable,
      },
    });

    if (!retryable) {
      return;
    }

    const nextRunAt = new Date(Date.now() + this.getRetryDelaySeconds(nextAttemptCount) * 1_000);

    await JobStateMachine.transition(this.db, jobId, JobStatus.FAILED, JobStatus.PENDING, {
      next_run_at: nextRunAt,
      started_at: null,
      completed_at: null,
    });

    await JobEventRepository.create(this.db, {
      job_id: jobId,
      event_type: 'status_changed',
      detail_json: {
        from: JobStatus.FAILED,
        to: JobStatus.PENDING,
        worker_id: this.workerId,
        next_run_at: nextRunAt.toISOString(),
      },
    });
  }
}

function resolveJobId<Payload extends BullMQJobPayload, Result, NameType extends string>(
  bullJob: BullMQJob<Payload, Result, NameType>,
): string {
  const dataJobId = bullJob.data?.jobId;
  if (typeof dataJobId === 'string' && dataJobId.length > 0) {
    return dataJobId;
  }

  if (typeof bullJob.id === 'string' && bullJob.id.length > 0) {
    return bullJob.id;
  }

  throw new Error('BullMQ job payload must include a string jobId');
}

function isRetryableFlag(error: unknown): error is { retryable?: boolean } {
  return typeof error === 'object' && error !== null && 'retryable' in error;
}

function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack !== undefined ? { stack: error.stack } : {}),
      ...(isRetryableFlag(error) && error.retryable !== undefined ? { retryable: error.retryable } : {}),
    };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  return {
    message: 'Job processing failed',
    detail: error,
  };
}
