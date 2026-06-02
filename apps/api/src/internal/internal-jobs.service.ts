import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  QueueFactory,
  QUEUE_INDEXING,
  JobConflictError,
  JobEventRepository,
  JobRepository,
  JobStateMachine,
  JobStatus,
  RedisJobLock,
  type BullMQConnection,
  jobs,
  type JobRow,
} from '@cherrygraph/job-core';
import { ErrorCode, graphEdges, graphifyRuns, graphNodes, spaces } from '@cherrygraph/shared';
import { GraphImportService, parseGraphJson, validateGraphOutput } from '@cherrygraph/graph-core';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service.js';
import { BridgeQueueService } from '../bridge/bridge-queue.service.js';
import { throwApiError } from '../common/errors/api-error.js';
import { getApiLogger } from '../common/logger/logger.module.js';
import { REDIS_CLIENT, type OptionalRedisClient } from '../common/redis/redis.module.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { GraphifyService } from '../graphify/graphify.service.js';
import { StorageService } from '../storage/storage.service.js';
import { deriveDisplayName } from '../jobs/jobs.service.js';
import type { JobDto, JobProgressDto } from '../jobs/jobs.dto.js';
import { UploadsService } from '../uploads/uploads.service.js';
import type {
  JobCompletionDto,
  JobFailureDto,
  JobFailureResponseDto,
  JobProgressUpdateDto,
  WorkerHeartbeatDto,
  WorkerHeartbeatResponseDto,
} from './internal.dto.js';

type JobsDatabase = NodePgDatabase;
type InternalRedisClient = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ...args: Array<string | number>) => Promise<string | null>;
  eval: (script: string, numKeys: number, ...args: Array<string | number>) => Promise<number | string | null>;
};
type StoredWorkerHeartbeat = {
  seen_at: string;
  system_info?: Record<string, unknown>;
};

const DEAD_WORKER_SCAN_INTERVAL_MS = 30_000;
const DEAD_WORKER_THRESHOLD_MS = 90_000;
const VALIDATION_JOB_POLL_INTERVAL_MS = 5_000;
// findPendingByType clamps the limit to Math.min(10, limit); keep this <= 10 or it is silently capped.
const VALIDATION_JOB_BATCH = 5;
// Lock-owner identity for in-process validation. This is the value stored in the Redis job lock
// and in jobs.locked_by — it is NEVER registered as a worker heartbeat, so it does not show up in
// the admin worker list. Suffixed with a per-instance UUID so a crashed instance's locks are
// distinguishable and reclaimable by scanDeadWorkers (no heartbeat -> activity-time fallback).
const IN_PROCESS_VALIDATION_OWNER_PREFIX = 'internal:validation';
const DEFAULT_LOCK_TTL_SECONDS = 600;
const HEARTBEAT_TTL_SECONDS = 180;
const MAX_GRAPH_JSON_BYTES = 128 * 1024 * 1024;
const GRAPH_IMPORT_BATCH_SIZE = 500;

@Injectable()
export class InternalJobsService {
  private readonly graphImportService = new GraphImportService();
  private validationPollInFlight = false;
  // Stable per-instance lock owner; not a worker, never heartbeated.
  private readonly validationLockOwner = `${IN_PROCESS_VALIDATION_OWNER_PREFIX}:${randomUUID()}`;

  constructor(
    @Inject(DRIZZLE) private readonly db: JobsDatabase,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: OptionalRedisClient,
    @Optional() private readonly uploadsService?: UploadsService,
    @Optional() private readonly auditService?: AuditService,
    @Optional() private readonly graphifyService?: GraphifyService,
    @Optional() private readonly bridgeQueueService?: BridgeQueueService,
    @Optional() private readonly storageService?: StorageService,
  ) {}

  async pollPendingJobs(type: string, limit: number, tenantId?: string): Promise<JobDto[]> {
    const pendingJobs = await JobRepository.findPendingByType(
      this.db,
      tenantId,
      type,
      limit,
    );
    return pendingJobs.map((job) => toJobDto(job));
  }

  async reportProgress(jobId: string, input: JobProgressUpdateDto): Promise<JobDto> {
    const job = await this.getJob(jobId);
    const progress = toProgressDto(input.percent, input.stage);

    if (isJobStatus(job.status, JobStatus.PENDING)) {
      await this.touchWorkerHeartbeat(input.worker_id);
      let lockAcquired = false;

      try {
        const runningJob = await this.db.transaction(async (tx) => {
          const txDb = tx as JobsDatabase;
          const startedAt = new Date();
          const nextJob = await JobStateMachine.transition(txDb, job.id, JobStatus.PENDING, JobStatus.RUNNING, {
            locked_by: input.worker_id,
            locked_at: startedAt,
            started_at: startedAt,
            completed_at: null,
            error_json: null,
            result_json: null,
          });

          if (!(await this.acquireJobLock(job.id, input.worker_id))) {
            throwApiError(ErrorCode.CONFLICT, 'Job lock already held by another worker', HttpStatus.CONFLICT);
          }
          lockAcquired = true;

          await JobEventRepository.create(txDb, {
            job_id: job.id,
            event_type: 'status_changed',
            detail_json: {
              from: JobStatus.PENDING,
              to: JobStatus.RUNNING,
              worker_id: input.worker_id,
            },
          });

          await JobEventRepository.create(txDb, {
            job_id: job.id,
            event_type: 'progress_updated',
            detail_json: progress,
          });

          return nextJob;
        });

        return toJobDto(runningJob, progress);
      } catch (error) {
        if (lockAcquired) {
          try {
            await this.releaseJobLock(job.id, input.worker_id);
          } catch (releaseError) {
            getApiLogger().error(
              { err: releaseError, job_id: job.id, worker_id: input.worker_id },
              'Failed to release job lock after pending job activation rollback',
            );
          }
        }

        handleJobConflict(error);
        throw error;
      }
    }

    this.assertRunningJobOwner(job, input.worker_id);
    await this.renewOwnedJobLock(job.id, input.worker_id);
    await this.touchWorkerHeartbeat(input.worker_id);
    await JobEventRepository.create(this.db, {
      job_id: job.id,
      event_type: 'progress_updated',
      detail_json: progress,
    });

    return toJobDto(job, progress);
  }

  async reportComplete(jobId: string, input: JobCompletionDto): Promise<JobDto> {
    const job = await this.getJob(jobId);
    this.assertRunningJobOwner(job, input.worker_id);
    await this.renewOwnedJobLock(job.id, input.worker_id);

    try {
      const completedJob = await this.db.transaction(async (tx) => {
        const txDb = tx as JobsDatabase;
        const completedAt = new Date();
        const nextJob = await JobStateMachine.transition(txDb, job.id, JobStatus.RUNNING, JobStatus.SUCCEEDED, {
          result_json: input.result_json ?? null,
          error_json: null,
          locked_by: null,
          locked_at: null,
          completed_at: completedAt,
        });

        await JobEventRepository.create(txDb, {
          job_id: job.id,
          event_type: 'status_changed',
          detail_json: {
            from: JobStatus.RUNNING,
            to: JobStatus.SUCCEEDED,
            worker_id: input.worker_id,
          },
        });

        return nextJob;
      });

      await this.releaseJobLock(job.id, input.worker_id);
      await this.handleSuccessfulJobCompletion(completedJob);
      return toJobDto(completedJob);
    } catch (error) {
      handleJobConflict(error);
      throw error;
    }
  }

  async reportFailure(jobId: string, input: JobFailureDto): Promise<JobFailureResponseDto> {
    const job = await this.getJob(jobId);
    this.assertRunningJobOwner(job, input.worker_id);
    await this.renewOwnedJobLock(job.id, input.worker_id);

    const nextAttemptCount = job.attempt_count + 1;
    const willRetry = input.retryable !== false && nextAttemptCount < job.max_attempts;

    try {
      const nextJob = await this.db.transaction(async (tx) => {
        const txDb = tx as JobsDatabase;
        const failedAt = new Date();
        const failedJob = await JobStateMachine.transition(txDb, job.id, JobStatus.RUNNING, JobStatus.FAILED, {
          attempt_count: nextAttemptCount,
          error_json: input.error_json,
          locked_by: null,
          locked_at: null,
          completed_at: failedAt,
        });

        await JobEventRepository.create(txDb, {
          job_id: job.id,
          event_type: 'status_changed',
          detail_json: {
            from: JobStatus.RUNNING,
            to: JobStatus.FAILED,
            worker_id: input.worker_id,
            retryable: willRetry,
          },
        });

        if (!willRetry) {
          return failedJob;
        }

        const nextRunAt = new Date(Date.now() + getRetryDelaySeconds() * 1_000);
        const retriedJob = await JobStateMachine.transition(txDb, job.id, JobStatus.FAILED, JobStatus.PENDING, {
          next_run_at: nextRunAt,
          started_at: null,
          completed_at: null,
        });

        await JobEventRepository.create(txDb, {
          job_id: job.id,
          event_type: 'status_changed',
          detail_json: {
            from: JobStatus.FAILED,
            to: JobStatus.PENDING,
            worker_id: input.worker_id,
            next_run_at: nextRunAt.toISOString(),
          },
        });

        return retriedJob;
      });

      await this.releaseJobLock(job.id, input.worker_id);
      await this.handleFailedJob(job, input.error_json, willRetry);
      return {
        job: toJobDto(nextJob),
        will_retry: willRetry,
      };
    } catch (error) {
      handleJobConflict(error);
      throw error;
    }
  }

  async recordHeartbeat(input: WorkerHeartbeatDto): Promise<WorkerHeartbeatResponseDto> {
    await this.touchWorkerHeartbeat(input.worker_id, input.system_info);
    const lostLocks: string[] = [];

    if (input.active_jobs !== undefined && input.active_jobs.length > 0) {
      for (const jobId of new Set(input.active_jobs)) {
        if (!(await this.tryRenewOwnedJobLock(jobId, input.worker_id))) {
          lostLocks.push(jobId);
        }
      }
    }

    return {
      ack: true,
      cancel_requested: await this.getCancelRequestedJobIds(input.worker_id, input.active_jobs),
      lost_locks: lostLocks,
    };
  }

  @Interval(DEAD_WORKER_SCAN_INTERVAL_MS)
  async scanDeadWorkers(): Promise<number> {
    if (this.redis === undefined) {
      return 0;
    }

    try {
      const runningJobs = (await this.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, JobStatus.RUNNING), isNotNull(jobs.locked_by)))) as JobRow[];
      const jobsByWorker = new Map<string, JobRow[]>();

      for (const job of runningJobs) {
        if (job.locked_by === null) {
          continue;
        }

        const workerJobs = jobsByWorker.get(job.locked_by) ?? [];
        workerJobs.push(job);
        jobsByWorker.set(job.locked_by, workerJobs);
      }

      let handled = 0;
      for (const [workerId, workerJobs] of jobsByWorker) {
        const heartbeat = await this.getWorkerHeartbeat(workerId);
        if (!isDeadWorker(workerJobs, heartbeat, Date.now())) {
          continue;
        }

        for (const job of workerJobs) {
          handled += await this.failDeadWorkerJob(job, heartbeat);
        }
      }

      return handled;
    } catch (error) {
      getApiLogger().error({ err: error }, 'Dead worker scan failed');
      return 0;
    }
  }

  // `validation` jobs have no external worker — cherry-api consumes them in-process via a
  // first-class internal handler (NOT by impersonating a remote worker). Each pending job is
  // claimed with a Redis job lock keyed by job id (safe across replicas), transitioned
  // PENDING→RUNNING, then the real validation work runs BEFORE any terminal transition. Only on
  // success do we move RUNNING→SUCCEEDED; on failure the job goes to FAILED and is requeued when
  // attempts remain, so a stuck `validating` document always has a recovery path.
  @Interval(VALIDATION_JOB_POLL_INTERVAL_MS)
  async processPendingValidationJobs(): Promise<number> {
    if (this.redis === undefined || this.validationPollInFlight) {
      return 0;
    }

    this.validationPollInFlight = true;
    try {
      // TODO(#4): pollPendingJobs passes no tenantId, so a noisy tenant can starve others within a
      // single batch. Per-tenant round-robin needs job-core changes (out of scope here).
      const pending = await this.pollPendingJobs('validation', VALIDATION_JOB_BATCH);
      if (pending.length === 0) {
        return 0;
      }

      getApiLogger().debug(
        { batch: pending.length, fairness: 'cross-tenant-fifo' },
        'Processing in-process validation batch (no per-tenant fairness — see TODO #4)',
      );

      // Process the batch concurrently; per-job failures must not abort the rest.
      const results = await Promise.allSettled(
        pending.map((job) => this.runInternalValidationJob(job.job_id)),
      );
      return results.reduce((processed, result) => {
        return processed + (result.status === 'fulfilled' && result.value ? 1 : 0);
      }, 0);
    } catch (error) {
      getApiLogger().error({ err: error }, 'In-process validation poll failed');
      return 0;
    } finally {
      this.validationPollInFlight = false;
    }
  }

  // Claim, run, and finalize a single validation job as a first-class internal consumer.
  // Returns true only when the job was claimed by THIS instance and reached SUCCEEDED.
  private async runInternalValidationJob(jobId: string): Promise<boolean> {
    const owner = this.validationLockOwner;
    let lockAcquired = false;

    try {
      const job = await JobRepository.findById(this.db, jobId);
      if (job === undefined || !isJobStatus(job.status, JobStatus.PENDING)) {
        return false;
      }

      // Acquire the Redis lock FIRST so a concurrent replica cannot also claim this job.
      // No worker heartbeat is written — the lock owner is an internal identity, not a worker.
      if (!(await this.acquireJobLock(jobId, owner))) {
        return false;
      }
      lockAcquired = true;

      // PENDING → RUNNING (real work has not run yet, so the job is recoverable on crash).
      const startedAt = new Date();
      let runningJob: JobRow;
      try {
        runningJob = await this.db.transaction(async (tx) => {
          const txDb = tx as JobsDatabase;
          const nextJob = await JobStateMachine.transition(txDb, jobId, JobStatus.PENDING, JobStatus.RUNNING, {
            locked_by: owner,
            locked_at: startedAt,
            started_at: startedAt,
            completed_at: null,
            error_json: null,
            result_json: null,
          });

          await JobEventRepository.create(txDb, {
            job_id: jobId,
            event_type: 'status_changed',
            detail_json: { from: JobStatus.PENDING, to: JobStatus.RUNNING, worker_id: owner },
          });

          return nextJob;
        });
      } catch (error) {
        // Another replica won the PENDING→RUNNING race — not our job, leave it alone.
        if (error instanceof JobConflictError) {
          return false;
        }
        throw error;
      }

      // Run the actual validation work BEFORE the terminal transition.
      const summary = await this.runValidationWork(runningJob).catch(async (error) => {
        // Work failed: fail the job recoverably and signal "not succeeded".
        await this.failInternalValidationJob(runningJob, owner, error);
        lockAcquired = false;
        throw error;
      });

      // RUNNING → SUCCEEDED only after the work succeeded.
      const completedAt = new Date();
      await this.db.transaction(async (tx) => {
        const txDb = tx as JobsDatabase;
        await JobStateMachine.transition(txDb, jobId, JobStatus.RUNNING, JobStatus.SUCCEEDED, {
          result_json: summary,
          error_json: null,
          locked_by: null,
          locked_at: null,
          completed_at: completedAt,
        });

        await JobEventRepository.create(txDb, {
          job_id: jobId,
          event_type: 'status_changed',
          detail_json: { from: JobStatus.RUNNING, to: JobStatus.SUCCEEDED, worker_id: owner },
        });
      });

      lockAcquired = false;
      await this.releaseJobLock(jobId, owner);
      return true;
    } catch (error) {
      // A transition (PENDING→RUNNING / RUNNING→SUCCEEDED) threw after we held the lock but the
      // validation-work failure path did not run. Release the lock so the job is reclaimable; the
      // job is still RUNNING/PENDING here, never a stuck SUCCEEDED.
      if (lockAcquired) {
        try {
          await this.releaseJobLock(jobId, owner);
        } catch (releaseError) {
          getApiLogger().error({ err: releaseError, job_id: jobId }, 'Failed to release in-process validation lock');
        }
      }
      getApiLogger().error({ err: error, job_id: jobId }, 'In-process validation job failed');
      return false;
    }
  }

  // Runs the real validation work for a RUNNING validation job and returns a result summary.
  // Throws if the work fails so the caller can transition the job to FAILED (recoverable),
  // instead of swallowing the error and stranding the document in `validating`.
  private async runValidationWork(job: JobRow): Promise<Record<string, unknown>> {
    const uploadsService = this.getRequiredUploadsService();
    const payload = asJsonRecord(job.payload_json);
    const sourceDocumentId = readString(payload.source_document_id);
    const quarantineKey = readString(payload.quarantine_key);
    if (sourceDocumentId === undefined || quarantineKey === undefined) {
      throwApiError(
        ErrorCode.INTERNAL_ERROR,
        'Validation job payload is missing source_document_id or quarantine_key',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const actor = {
      tenantId: job.tenant_id,
      ...(job.created_by !== null ? { actorUserId: job.created_by, userId: job.created_by } : {}),
    };

    const validation = await uploadsService.validateQuarantinedUpload(
      { sourceDocumentId, quarantineKey },
      actor,
    );
    if (!validation.pass) {
      // Validation rejected the file. The upload service has already moved the document to its
      // rejected state; the job itself succeeded (it did its job), so record the outcome.
      return { validated: true, passed: false };
    }

    await uploadsService.completeValidation({ sourceDocumentId, quarantineKey }, actor);
    return { validated: true, passed: true };
  }

  // Transition a RUNNING internal validation job to FAILED, requeueing it when attempts remain.
  // Mirrors the reportFailure semantics so recovery is identical to remote-worker failures.
  // If max_attempts is reached the job stays terminal FAILED (no infra exists to requeue beyond
  // max_attempts); an operator can then inspect error_json.
  private async failInternalValidationJob(runningJob: JobRow, owner: string, error: unknown): Promise<void> {
    const jobId = runningJob.id;
    const errorJson = toValidationErrorJson(error);
    const nextAttemptCount = runningJob.attempt_count + 1;
    const willRetry = nextAttemptCount < runningJob.max_attempts;

    try {
      // The RUNNING→FAILED transition is guarded by status = RUNNING in JobStateMachine, so if a
      // dead-worker scan already reclaimed this job the transition throws JobConflictError below.
      await this.db.transaction(async (tx) => {
        const txDb = tx as JobsDatabase;
        const failedAt = new Date();
        await JobStateMachine.transition(txDb, jobId, JobStatus.RUNNING, JobStatus.FAILED, {
          attempt_count: nextAttemptCount,
          error_json: errorJson,
          locked_by: null,
          locked_at: null,
          completed_at: failedAt,
        });

        await JobEventRepository.create(txDb, {
          job_id: jobId,
          event_type: 'status_changed',
          detail_json: { from: JobStatus.RUNNING, to: JobStatus.FAILED, worker_id: owner, retryable: willRetry },
        });

        if (!willRetry) {
          return;
        }

        const nextRunAt = new Date(failedAt.getTime() + getRetryDelaySeconds() * 1_000);
        await JobStateMachine.transition(txDb, jobId, JobStatus.FAILED, JobStatus.PENDING, {
          next_run_at: nextRunAt,
          started_at: null,
          completed_at: null,
        });

        await JobEventRepository.create(txDb, {
          job_id: jobId,
          event_type: 'status_changed',
          detail_json: {
            from: JobStatus.FAILED,
            to: JobStatus.PENDING,
            worker_id: owner,
            next_run_at: nextRunAt.toISOString(),
          },
        });
      });
    } catch (failError) {
      if (!(failError instanceof JobConflictError)) {
        getApiLogger().error({ err: failError, job_id: jobId }, 'Failed to record in-process validation failure');
      }
    } finally {
      await this.releaseJobLock(jobId, owner);
    }
  }

  private async getJob(jobId: string): Promise<JobRow> {
    const job = await JobRepository.findById(this.db, jobId);
    if (job === undefined) {
      throwApiError(ErrorCode.NOT_FOUND, 'Job not found', HttpStatus.NOT_FOUND);
    }

    return job;
  }

  private assertRunningJobOwner(job: JobRow, workerId: string): void {
    if (!isJobStatus(job.status, JobStatus.RUNNING)) {
      throwApiError(ErrorCode.CONFLICT, 'Job is not running', HttpStatus.CONFLICT);
    }

    if (job.locked_by !== workerId) {
      throwApiError(ErrorCode.CONFLICT, 'Job not owned by this worker', HttpStatus.CONFLICT);
    }
  }

  private async acquireJobLock(jobId: string, workerId: string): Promise<boolean> {
    const redis = this.getRequiredRedis();
    return RedisJobLock.acquire(redis, jobId, workerId, DEFAULT_LOCK_TTL_SECONDS);
  }

  private async tryRenewOwnedJobLock(jobId: string, workerId: string): Promise<boolean> {
    const redis = this.getRequiredRedis();
    return RedisJobLock.renew(redis, jobId, workerId, DEFAULT_LOCK_TTL_SECONDS);
  }

  private async renewOwnedJobLock(jobId: string, workerId: string): Promise<void> {
    if (!(await this.tryRenewOwnedJobLock(jobId, workerId))) {
      throwApiError(ErrorCode.CONFLICT, 'Job not owned by this worker', HttpStatus.CONFLICT);
    }
  }

  private async releaseJobLock(jobId: string, workerId: string): Promise<void> {
    const redis = this.getRequiredRedis();
    const released = await RedisJobLock.release(redis, jobId, workerId);

    if (!released) {
      getApiLogger().warn({ job_id: jobId, worker_id: workerId }, 'Worker lock was not released because ownership changed');
    }
  }

  private async touchWorkerHeartbeat(workerId: string, systemInfo?: Record<string, unknown>): Promise<void> {
    const redis = this.getRequiredRedis();
    const seenAt = new Date().toISOString();
    const payload: StoredWorkerHeartbeat = {
      seen_at: seenAt,
      ...(systemInfo !== undefined ? { system_info: systemInfo } : {}),
    };

    await redis.set(workerHeartbeatKey(workerId), JSON.stringify(payload), 'EX', HEARTBEAT_TTL_SECONDS);
  }

  private async getWorkerHeartbeat(workerId: string): Promise<Date | null> {
    const redis = this.getRequiredRedis();
    const stored = await redis.get(workerHeartbeatKey(workerId));
    return parseWorkerHeartbeat(stored);
  }

  private async getCancelRequestedJobIds(workerId: string, activeJobs?: string[]): Promise<string[]> {
    if (activeJobs !== undefined && activeJobs.length === 0) {
      return [];
    }

    const conditions = [
      eq(jobs.status, JobStatus.RUNNING),
      eq(jobs.locked_by, workerId),
      isNotNull(jobs.cancel_requested_at),
    ];

    if (activeJobs !== undefined && activeJobs.length > 0) {
      conditions.push(inArray(jobs.id, [...new Set(activeJobs)]));
    }

    const rows = await this.db
      .select({ job_id: jobs.id })
      .from(jobs)
      .where(and(...conditions));

    return rows.map((row) => row.job_id);
  }

  private async failDeadWorkerJob(job: JobRow, lastHeartbeatAt: Date | null): Promise<number> {
    if (job.locked_by === null) {
      return 0;
    }

    const workerId = job.locked_by;
    const nextAttemptCount = job.attempt_count + 1;
    const willRetry = nextAttemptCount < job.max_attempts;

    try {
      await this.db.transaction(async (tx) => {
        const txDb = tx as JobsDatabase;
        const failedAt = new Date();
        await JobStateMachine.transition(txDb, job.id, JobStatus.RUNNING, JobStatus.FAILED, {
          attempt_count: nextAttemptCount,
          error_json: {
            code: ErrorCode.WORKER_TIMEOUT,
            message: 'Worker heartbeat timed out',
          },
          locked_by: null,
          locked_at: null,
          completed_at: failedAt,
        });

        await JobEventRepository.create(txDb, {
          job_id: job.id,
          event_type: 'status_changed',
          detail_json: {
            from: JobStatus.RUNNING,
            to: JobStatus.FAILED,
            worker_id: workerId,
            retryable: willRetry,
            reason: 'worker_timeout',
          },
        });

        if (willRetry) {
          const nextRunAt = new Date(failedAt.getTime() + getRetryDelaySeconds() * 1_000);

          await JobStateMachine.transition(txDb, job.id, JobStatus.FAILED, JobStatus.PENDING, {
            next_run_at: nextRunAt,
            started_at: null,
            completed_at: null,
          });

          await JobEventRepository.create(txDb, {
            job_id: job.id,
            event_type: 'status_changed',
            detail_json: {
              from: JobStatus.FAILED,
              to: JobStatus.PENDING,
              worker_id: workerId,
              reason: 'worker_timeout_retry',
              next_run_at: nextRunAt.toISOString(),
            },
          });
        }

        await JobEventRepository.create(txDb, {
          job_id: job.id,
          event_type: 'timeout_detected',
          detail_json: {
            worker_id: workerId,
            locked_at: job.locked_at?.toISOString() ?? null,
            last_heartbeat_at: lastHeartbeatAt?.toISOString() ?? null,
            reason: 'worker_missed_heartbeat',
          },
        });
      });

      await this.releaseJobLock(job.id, workerId);
      if (job.type === 'ingestion' && !willRetry) {
        await this.handleIngestionFailure(job, willRetry);
      }

      return 1;
    } catch (error) {
      if (error instanceof JobConflictError) {
        return 0;
      }

      throw error;
    }
  }

  private getRequiredRedis(): InternalRedisClient {
    if (this.redis === undefined) {
      throwApiError(ErrorCode.INTERNAL_ERROR, 'Redis is not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return this.redis as unknown as InternalRedisClient;
  }

  private async handleSuccessfulJobCompletion(job: JobRow): Promise<void> {
    if (job.type === 'url_fetch') {
      await this.handleUrlFetchCompletion(job);
      return;
    }

    if (job.type === 'ingestion') {
      await this.handleIngestionCompletion(job);
      return;
    }

    if (job.type === 'graphify') {
      await this.handleGraphifyCompletion(job);
      return;
    }

    if (job.type !== 'validation') {
      return;
    }
    const uploadsService = this.getRequiredUploadsService();

    const payload = asJsonRecord(job.payload_json);
    const sourceDocumentId = typeof payload.source_document_id === 'string' ? payload.source_document_id : undefined;
    const quarantineKey = typeof payload.quarantine_key === 'string' ? payload.quarantine_key : undefined;
    if (sourceDocumentId === undefined || quarantineKey === undefined) {
      throwApiError(ErrorCode.INTERNAL_ERROR, 'Validation job payload is missing source_document_id or quarantine_key', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      const validation = await uploadsService.validateQuarantinedUpload(
        {
          sourceDocumentId,
          quarantineKey,
        },
        {
          tenantId: job.tenant_id,
          ...(job.created_by !== null ? { actorUserId: job.created_by, userId: job.created_by } : {}),
        },
      );
      if (!validation.pass) {
        return;
      }

      await uploadsService.completeValidation(
        {
          sourceDocumentId,
          quarantineKey,
        },
        {
          tenantId: job.tenant_id,
          ...(job.created_by !== null ? { actorUserId: job.created_by, userId: job.created_by } : {}),
        },
      );
    } catch (err) {
      getApiLogger().error(
        { err, job_id: job.id, source_document_id: sourceDocumentId },
        'Validation job succeeded but post-completion archive/ingestion failed — document may require manual reprocessing',
      );
    }
  }

  private async handleUrlFetchCompletion(job: JobRow): Promise<void> {
    const uploadsService = this.getRequiredUploadsService();
    const payload = asJsonRecord(job.payload_json);
    const result = asJsonRecord(job.result_json);
    const sourceDocumentId = readString(payload.source_document_id) ?? readString(result.source_document_id);
    const sha256 = readString(result.sha256);
    const snapshotUri = readString(result.snapshot_uri);
    const contentType = readString(result.content_type);
    const sizeBytes = readFiniteInteger(result.size_bytes);
    const hostname = readString(result.hostname);

    if (sourceDocumentId === undefined || sha256 === undefined || snapshotUri === undefined || contentType === undefined || sizeBytes === undefined) {
      throwApiError(ErrorCode.INTERNAL_ERROR, 'URL fetch result is missing source_document_id, sha256, snapshot_uri, content_type, or size_bytes', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      await uploadsService.linkBlob(
        {
          sourceDocumentId,
          sha256,
          sizeBytes,
          mimeType: contentType,
          storageUri: snapshotUri,
          ...(hostname !== undefined ? { filename: hostname } : {}),
        },
        {
          tenantId: job.tenant_id,
          ...(job.created_by !== null ? { actorUserId: job.created_by, userId: job.created_by } : {}),
        },
      );
    } catch (err) {
      getApiLogger().error(
        { err, job_id: job.id, source_document_id: sourceDocumentId },
        'URL fetch job succeeded but linkBlob/ingestion chaining failed — document may require manual reprocessing',
      );
    }
  }

  private async handleIngestionFailure(job: JobRow, willRetry: boolean): Promise<void> {
    if (willRetry) {
      return;
    }

    const uploadsService = this.getRequiredUploadsService();
    const payload = asJsonRecord(job.payload_json);
    const sourceDocumentId = readString(payload.source_document_id);
    if (sourceDocumentId === undefined) {
      return;
    }

    try {
      await uploadsService.markIngestionFailed(sourceDocumentId, { tenantId: job.tenant_id });
    } catch (err) {
      getApiLogger().error(
        { err, job_id: job.id, source_document_id: sourceDocumentId },
        'Failed to mark source_document as parse_failed',
      );
    }
  }

  private async handleIngestionCompletion(job: JobRow): Promise<void> {
    const uploadsService = this.getRequiredUploadsService();
    const payload = asJsonRecord(job.payload_json);
    const result = asJsonRecord(job.result_json);
    const sourceDocumentId = readString(payload.source_document_id) ?? readString(asJsonRecord(result.metadata).source_document_id);
    if (sourceDocumentId === undefined) {
      getApiLogger().warn({ job_id: job.id }, 'Ingestion job missing source_document_id — skipping status update');
      return;
    }

    try {
      const parsedUri = readString(result.parsed_uri);
      const previewUri = readString(result.preview_uri);
      await uploadsService.markIngestionComplete(sourceDocumentId, {
        ...(parsedUri !== undefined ? { parsedUri } : {}),
        ...(previewUri !== undefined ? { previewUri } : {}),
      }, { tenantId: job.tenant_id });
      await uploadsService.handleGraphifyHandoff(sourceDocumentId, { tenantId: job.tenant_id });
    } catch (err) {
      getApiLogger().error(
        { err, job_id: job.id, source_document_id: sourceDocumentId },
        'Ingestion job succeeded but status update or graphify handoff failed — document may require manual reprocessing',
      );
    }
  }

  private async handleGraphifyCompletion(job: JobRow): Promise<void> {
    if (this.graphifyService === undefined) {
      getApiLogger().warn(
        { job_id: job.id },
        'Graphify job succeeded but GraphifyService is not configured — skipping API post-completion pipeline',
      );
      return;
    }

    const payload = asJsonRecord(job.payload_json);
    const runId = readString(payload.run_id) ?? job.id;

    try {
      const completedRun = await this.graphifyService.handleRunCompletion(runId, asJsonRecord(job.result_json));
      if (completedRun.status !== 'succeeded') {
        getApiLogger().warn(
          { job_id: job.id, run_id: runId, run_status: completedRun.status },
          'Graphify run completion did not transition to succeeded — skipping indexing trigger',
        );
        return;
      }

      const graphJsonUri = readString(asJsonRecord(job.result_json).graph_json_uri) ?? null;
      await this.importGraphData(job.tenant_id, job.space_id ?? completedRun.space_id, runId, graphJsonUri, job.id);

      const indexJob = await JobRepository.create(this.db, {
        tenant_id: job.tenant_id,
        space_id: job.space_id,
        queue_name: QUEUE_INDEXING,
        type: 'reindex',
        payload_json: {
          tenant_id: job.tenant_id,
          space_id: job.space_id,
          graphify_run_id: readString(payload.run_id),
          trigger: 'graphify_completion',
          scope: 'full',
        },
        created_by: job.created_by,
      });

      const redis = this.getRequiredRedis();
      const queue = QueueFactory.createQueue<{ jobId: string }>(
        QUEUE_INDEXING,
        redis as unknown as BullMQConnection,
      );
      try {
        await queue.add('reindex', { jobId: indexJob.id });
      } finally {
        await queue.close();
      }

      if (this.bridgeQueueService !== undefined) {
        const hasDocmostMapping = await this.hasDocmostSpaceMapping(completedRun.space_id, job.id, runId);
        if (!hasDocmostMapping) {
          return;
        }

        try {
          await this.bridgeQueueService.enqueueDocmostPushJob({
            runId,
            spaceId: completedRun.space_id,
            tenantId: job.tenant_id,
          });
        } catch (err) {
          getApiLogger().error(
            { err, job_id: job.id, run_id: runId },
            'Failed to enqueue Docmost sync job after Graphify completion',
          );

          await this.db
            .update(graphifyRuns)
            .set({ status: 'docmost_sync_failed' })
            .where(and(eq(graphifyRuns.id, runId), eq(graphifyRuns.status, 'succeeded')));
          return;
        }

        try {
          await this.db
            .update(graphifyRuns)
            .set({ status: 'docmost_syncing' })
            .where(and(eq(graphifyRuns.id, runId), eq(graphifyRuns.status, 'succeeded')));
        } catch (statusErr) {
          getApiLogger().error(
            { err: statusErr, job_id: job.id, run_id: runId },
            'Failed to update run status to docmost_syncing after enqueue — push job is queued but status is stale',
          );
        }
      }
    } catch (err) {
      getApiLogger().error(
        { err, job_id: job.id, run_id: runId },
        'Graphify job succeeded but API post-completion pipeline failed — run may require manual reconciliation',
      );
    }
  }

  private async importGraphData(
    tenantId: string,
    spaceId: string,
    runId: string,
    graphJsonUri: string | null,
    jobId: string,
  ): Promise<void> {
    if (graphJsonUri === null || graphJsonUri.length === 0) {
      getApiLogger().info({ job_id: jobId, run_id: runId }, 'No graph_json_uri — skipping graph import');
      return;
    }

    if (this.storageService === undefined || !this.storageService.isConfigured()) {
      getApiLogger().warn({ job_id: jobId, run_id: runId }, 'StorageService not configured — skipping graph import');
      return;
    }

    try {
      const { bucket, key } = parseS3Uri(graphJsonUri);
      const stream = await this.storageService.download(bucket, key);
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      for await (const chunk of stream) {
        const buffer: Uint8Array = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.byteLength;
        if (totalBytes > MAX_GRAPH_JSON_BYTES) {
          getApiLogger().warn(
            { job_id: jobId, run_id: runId, graph_json_uri: graphJsonUri, size_bytes: totalBytes, limit_bytes: MAX_GRAPH_JSON_BYTES },
            'Graph JSON exceeds import size limit — skipping graph import',
          );
          return;
        }
        chunks.push(buffer);
      }
      const raw = Buffer.concat(chunks).toString('utf-8');

      const parsed = parseGraphJson(raw);
      const validation = validateGraphOutput(parsed);
      if (!validation.valid) {
        getApiLogger().warn(
          { job_id: jobId, run_id: runId, errors: validation.errors },
          'Graph validation failed — skipping graph import',
        );
        return;
      }

      const importOp = this.graphImportService.importRun(tenantId, spaceId, runId, validation);

      const edgesCreated = await this.db.transaction(async (tx) => {
        const txDb = tx as JobsDatabase;

        const nodeValues = importOp.nodes.map((node) => ({
          id: randomUUID(),
          tenant_id: tenantId,
          space_id: spaceId,
          graphify_run_id: runId,
          node_key: node.nodeKey,
          stable_key: node.stableKey,
          label: node.label,
          norm_label: node.normLabel,
          type: node.type,
          community_id: node.communityId,
          source_refs_json: node.sourceRefsJson,
        }));

        for (const nodeBatch of chunkArray(nodeValues, GRAPH_IMPORT_BATCH_SIZE)) {
          await txDb.insert(graphNodes).values(nodeBatch).onConflictDoNothing();
        }

        const nodeRows = await txDb
          .select({ id: graphNodes.id, node_key: graphNodes.node_key })
          .from(graphNodes)
          .where(
            and(
              eq(graphNodes.tenant_id, tenantId),
              eq(graphNodes.space_id, spaceId),
              eq(graphNodes.graphify_run_id, runId),
            ),
          );
        const nodeKeyToId = new Map(nodeRows.map((row) => [row.node_key, row.id]));

        const edgeValues = importOp.edges.flatMap((edge) => {
          const sourceNodeId = nodeKeyToId.get(edge.sourceNodeKey);
          const targetNodeId = nodeKeyToId.get(edge.targetNodeKey);
          if (sourceNodeId === undefined || targetNodeId === undefined) {
            return [];
          }

          return [{
            id: randomUUID(),
            tenant_id: tenantId,
            space_id: spaceId,
            graphify_run_id: runId,
            source_node_id: sourceNodeId,
            target_node_id: targetNodeId,
            relation_type: edge.relationType,
            confidence_label: edge.confidenceLabel,
            raw_confidence_score: edge.rawScore,
            effective_confidence_score: edge.effectiveScore,
            evidence_count: edge.evidenceCount,
          }];
        });

        for (const edgeBatch of chunkArray(edgeValues, GRAPH_IMPORT_BATCH_SIZE)) {
          await txDb.insert(graphEdges).values(edgeBatch).onConflictDoNothing();
        }

        return edgeValues.length;
      });

      getApiLogger().info(
        { job_id: jobId, run_id: runId, nodes: importOp.nodes.length, edges: edgesCreated },
        'Graph data imported successfully',
      );
    } catch (err) {
      getApiLogger().error(
        { err, job_id: jobId, run_id: runId },
        'Graph data import failed — nodes/edges may be incomplete',
      );
    }
  }

  private async hasDocmostSpaceMapping(spaceId: string, jobId: string, runId: string): Promise<boolean> {
    try {
      const [space] = await this.db
        .select({ docmost_space_id: spaces.docmost_space_id })
        .from(spaces)
        .where(eq(spaces.id, spaceId));

      if (space?.docmost_space_id !== null && space?.docmost_space_id !== undefined) {
        return true;
      }

      getApiLogger().info(
        { job_id: jobId, run_id: runId, space_id: spaceId },
        'Docmost push skipped: space not mapped to Docmost',
      );
      return false;
    } catch (err) {
      getApiLogger().warn(
        { err, job_id: jobId, run_id: runId, space_id: spaceId },
        'Docmost push skipped: failed to check space Docmost mapping',
      );
      return false;
    }
  }

  private async handleFailedJob(job: JobRow, errorJson: Record<string, unknown>, willRetry: boolean): Promise<void> {
    if (job.type === 'ingestion') {
      await this.handleIngestionFailure(job, willRetry);
      return;
    }

    if (job.type === 'graphify') {
      if (willRetry) {
        return;
      }

      const payload = asJsonRecord(job.payload_json);
      const runId = readString(payload.run_id) ?? job.id;
      await this.graphifyService?.handleRunFailure(runId, {
        error_json: Object.keys(errorJson).length > 0
          ? errorJson
          : { reason: 'worker_failure', details: String(job.error_json) },
      });
      return;
    }

    if (job.type !== 'url_fetch') {
      return;
    }

    const error = asJsonRecord(errorJson);
    if (error.error_type !== 'ssrf_blocked') {
      return;
    }

    const payload = asJsonRecord(job.payload_json);
    const sourceDocumentId = readString(payload.source_document_id);
    this.auditService?.push({
      tenant_id: job.tenant_id,
      ...(job.created_by !== null ? { actor_user_id: job.created_by } : {}),
      action: 'upload.ssrf_blocked',
      resource_type: 'source_document',
      ...(sourceDocumentId !== undefined ? { resource_id: sourceDocumentId } : {}),
      ...(job.space_id !== null ? { space_id: job.space_id } : {}),
      metadata_json: {
        source_document_id: sourceDocumentId,
        target_url: readString(error.target_url) ?? readString(payload.url),
        resolved_ip: readString(error.resolved_ip),
        block_reason: readString(error.block_reason),
        redirect_chain: Array.isArray(error.redirect_chain) ? error.redirect_chain : [],
      },
    });
  }

  private getRequiredUploadsService(): UploadsService {
    if (this.uploadsService === undefined) {
      throwApiError(ErrorCode.INTERNAL_ERROR, 'Uploads service is not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return this.uploadsService;
  }
}

function toJobDto(job: JobRow, progress: JobProgressDto | null = null): JobDto {
  return {
    job_id: job.id,
    tenant_id: job.tenant_id,
    type: job.type,
    display_name: deriveDisplayName(job),
    status: job.status,
    space_id: job.space_id,
    progress,
    created_by: job.created_by,
    payload_json: job.payload_json,
    result_json: job.result_json,
    error_json: job.error_json,
    cancel_requested_at: job.cancel_requested_at,
    attempt_count: job.attempt_count,
    max_attempts: job.max_attempts,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toProgressDto(percent: number, stage: string | undefined): JobProgressDto {
  return {
    percent,
    ...(typeof stage === 'string' && stage.trim().length > 0 ? { stage } : {}),
  };
}

function handleJobConflict(error: unknown): void {
  if (error instanceof JobConflictError) {
    throwApiError(ErrorCode.CONFLICT, error.message, HttpStatus.CONFLICT);
  }
}

function getRetryDelaySeconds(): number {
  return 0;
}

function toValidationErrorJson(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { code: ErrorCode.INTERNAL_ERROR, message: error.message };
  }
  return { code: ErrorCode.INTERNAL_ERROR, message: String(error) };
}

function workerHeartbeatKey(workerId: string): string {
  return `worker:heartbeat:${workerId}`;
}

function parseWorkerHeartbeat(value: string | null): Date | null {
  if (value === null || value.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<StoredWorkerHeartbeat>;
    if (typeof parsed.seen_at === 'string') {
      return parseDate(parsed.seen_at);
    }
  } catch {
    return parseDate(value);
  }

  return null;
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isDeadWorker(jobsForWorker: JobRow[], lastHeartbeatAt: Date | null, now: number): boolean {
  if (lastHeartbeatAt !== null) {
    return now - lastHeartbeatAt.getTime() > DEAD_WORKER_THRESHOLD_MS;
  }

  const mostRecentActivityAt = jobsForWorker.reduce<number>((latest, job) => {
    const candidate = job.locked_at ?? job.started_at ?? job.created_at;
    return Math.max(latest, candidate.getTime());
  }, 0);

  return mostRecentActivityAt > 0 && now - mostRecentActivityAt > DEAD_WORKER_THRESHOLD_MS;
}

function isJobStatus(status: string, expected: JobStatus): boolean {
  return status === String(expected);
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readFiniteInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.trunc(value);
}

function parseS3Uri(uri: string): { bucket: string; key: string } {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Invalid S3 URI: ${uri}`);
  }
  return { bucket: match[1], key: match[2] };
}
