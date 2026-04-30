import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { JobEventRepository } from './event-repository.js';
import { RedisJobLock, type RedisJobLockClient } from './lock.js';
import type { JobDatabase } from './repository.js';
import { jobs, type JobRow } from './schema.js';
import { JobConflictError, JobStateMachine } from './state-machine.js';
import { JobStatus } from './status.js';

export const DEFAULT_JOB_TIMEOUT_SECONDS = 1_800;
const MAX_RETRY_DELAY_SECONDS = 1_800;

export class TimeoutScanner {
  static async scan(db: JobDatabase, redis: RedisJobLockClient): Promise<number> {
    const expiredJobs = (await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.status, JobStatus.RUNNING),
          isNotNull(jobs.locked_at),
          sql`${jobs.locked_at} + coalesce(${jobs.timeout_seconds}, ${DEFAULT_JOB_TIMEOUT_SECONDS}) * interval '1 second' < now()`,
        ),
      )) as JobRow[];

    let handled = 0;

    for (const job of expiredJobs) {
      try {
        const completedAt = new Date();
        await JobStateMachine.transition(db, job.id, JobStatus.RUNNING, JobStatus.FAILED, {
          attempt_count: job.attempt_count + 1,
          error_json: {
            code: 'TIMEOUT',
            message: 'Job exceeded timeout',
          },
          locked_by: null,
          locked_at: null,
          completed_at: completedAt,
        });

        await JobEventRepository.create(db, {
          job_id: job.id,
          event_type: 'status_changed',
          detail_json: {
            from: JobStatus.RUNNING,
            to: JobStatus.FAILED,
            reason: 'timeout',
          },
        });

        const nextAttemptCount = job.attempt_count + 1;
        if (nextAttemptCount < job.max_attempts) {
          const nextRunAt = new Date(Date.now() + getRetryDelaySeconds(nextAttemptCount) * 1_000);

          await JobStateMachine.transition(db, job.id, JobStatus.FAILED, JobStatus.PENDING, {
            next_run_at: nextRunAt,
            started_at: null,
            completed_at: null,
          });

          await JobEventRepository.create(db, {
            job_id: job.id,
            event_type: 'status_changed',
            detail_json: {
              from: JobStatus.FAILED,
              to: JobStatus.PENDING,
              reason: 'timeout_retry',
              next_run_at: nextRunAt.toISOString(),
            },
          });
        }

        await JobEventRepository.create(db, {
          job_id: job.id,
          event_type: 'timeout_detected',
          detail_json: {
            worker_id: job.locked_by,
            locked_at: job.locked_at?.toISOString() ?? null,
            timeout_seconds: job.timeout_seconds ?? DEFAULT_JOB_TIMEOUT_SECONDS,
          },
        });

        if (job.locked_by !== null) {
          await RedisJobLock.release(redis, job.id, job.locked_by);
        }

        handled += 1;
      } catch (error) {
        if (error instanceof JobConflictError) {
          continue;
        }

        throw error;
      }
    }

    return handled;
  }
}

function getRetryDelaySeconds(nextAttemptCount: number): number {
  return Math.min(60 * 2 ** Math.max(0, nextAttemptCount - 1), MAX_RETRY_DELAY_SECONDS);
}
