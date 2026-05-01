import { HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  JobConflictError,
  JobEventRepository,
  JobRepository,
  JobStateMachine,
  JobStatus,
  RedisJobLock,
  jobs,
  type JobRow,
} from '@cherrygraph/job-core';
import { ErrorCode } from '@cherrygraph/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { AuditService } from '../audit/audit.service.js';
import { getApiLogger } from '../common/logger/logger.module.js';
import { REDIS_CLIENT, type OptionalRedisClient } from '../common/redis/redis.module.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { UploadsService } from '../uploads/uploads.service.js';
import type {
  JobCompletionDto,
  JobFailureDto,
  JobFailureResponseDto,
  JobProgressUpdateDto,
  WorkerHeartbeatDto,
  WorkerHeartbeatResponseDto,
} from './internal.dto.js';
import type { JobDto, JobProgressDto } from '../jobs/jobs.dto.js';

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
const DEFAULT_LOCK_TTL_SECONDS = 600;
const HEARTBEAT_TTL_SECONDS = 180;
const MAX_RETRY_DELAY_SECONDS = 1_800;

@Injectable()
export class InternalJobsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: JobsDatabase,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: OptionalRedisClient,
    @Optional() private readonly uploadsService?: UploadsService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async pollPendingJobs(type: string, limit: number): Promise<JobDto[]> {
    const pendingJobs = await JobRepository.findPendingByType(
      this.db,
      process.env.DEFAULT_TENANT_ID ?? 'default',
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

          await this.renewOwnedJobLock(job.id, input.worker_id);

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

        const nextRunAt = new Date(Date.now() + getRetryDelaySeconds(nextAttemptCount) * 1_000);
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
      await this.handleFailedJob(job, input.error_json);
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
            code: 'WORKER_TIMEOUT',
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
          const nextRunAt = new Date(failedAt.getTime() + getRetryDelaySeconds(nextAttemptCount) * 1_000);

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

  private async handleFailedJob(job: JobRow, errorJson: Record<string, unknown>): Promise<void> {
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

function throwApiError(code: ErrorCode, message: string, status: HttpStatus): never {
  throw new HttpException({ code, message }, status);
}

function getRetryDelaySeconds(nextAttemptCount: number): number {
  return Math.min(60 * 2 ** Math.max(0, nextAttemptCount - 1), MAX_RETRY_DELAY_SECONDS);
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
