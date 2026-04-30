import { and, eq } from 'drizzle-orm';

import type { JobDatabase, JobUpdateInput } from './repository.js';
import { JobRepository } from './repository.js';
import { jobs, type JobRow } from './schema.js';
import { JobStatus } from './status.js';

export class JobConflictError extends Error {
  readonly statusCode = 409;

  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'JobConflictError';
  }
}

export class JobStateMachine {
  static readonly TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
    [JobStatus.PENDING]: [JobStatus.RUNNING, JobStatus.CANCELLED],
    [JobStatus.RUNNING]: [JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED],
    [JobStatus.SUCCEEDED]: [],
    [JobStatus.FAILED]: [JobStatus.PENDING],
    [JobStatus.CANCELLED]: [],
  };

  static validate(from: JobStatus | string, to: JobStatus | string): void {
    const allowed = this.TRANSITIONS[from as JobStatus] ?? [];

    if (!allowed.includes(to as JobStatus)) {
      throw new JobConflictError(`Invalid job status transition from ${from} to ${to}`, {
        from,
        to,
      });
    }
  }

  static async transition(
    db: JobDatabase,
    jobId: string,
    from: JobStatus | string,
    to: JobStatus | string,
    updates: JobUpdateInput = {},
  ): Promise<JobRow> {
    this.validate(from, to);

    const [updated] = (await db
      .update(jobs)
      .set({
        status: to,
        ...updates,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, from)))
      .returning()) as JobRow[];

    if (updated !== undefined) {
      return updated;
    }

    const existing = await JobRepository.findById(db, jobId);
    if (existing === undefined) {
      throw new Error(`Job ${jobId} not found`);
    }

    throw new JobConflictError(
      `Cannot transition job ${jobId} from ${from} to ${to}: current status is ${existing.status}`,
      {
        jobId,
        expectedStatus: from,
        currentStatus: existing.status,
        nextStatus: to,
      },
    );
  }
}
