import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  JobConflictError,
  JobEventRepository,
  JobRepository,
  JobStateMachine,
  JobStatus,
  job_events,
  jobs,
  type JobEventRow,
  type JobRow,
} from '@cherrygraph/job-core';
import { ROLE_PERMISSIONS, ROLES, normalizeRole } from '@cherrygraph/auth-core';
import { ErrorCode, group_members, space_permissions } from '@cherrygraph/shared';
import {
  asc,
  and,
  desc,
  eq,
  inArray,
  isNull,
} from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  buildPaginationMeta,
  paginatedResponse,
  parseSortField,
  type PaginatedResponse,
} from '../common/dto/pagination.dto.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import {
  JOB_SORT_FIELDS,
  type AdminJobListQueryDto,
  type CancelJobResponseDto,
  type JobDto,
  type JobEventDto,
  JobEventsQueryDto,
  type JobProgressDto,
} from './jobs.dto.js';

type JobsDatabase = NodePgDatabase;
type JobSortField = (typeof JOB_SORT_FIELDS)[number];
type JobSortDirection = 'asc' | 'desc';
type ParsedJobSort = {
  field: JobSortField;
  direction: JobSortDirection;
};

export type JobContext = {
  tenantId?: string;
  actorUserId?: string;
  actorPermissions?: string[];
  actorRole?: string;
  userId?: string;
};

type JobAccessMode = 'view' | 'cancel';

const VIEW_SATISFYING_PERMISSIONS = ['space:view', 'space:edit', 'space:admin'] as const;
const CANCEL_SATISFYING_PERMISSIONS = ['space:admin'] as const;
const AUDIT_VIEW_PERMISSION = 'admin:audit_view';
const MAX_CANCELLATION_RETRIES = 3;
const PROGRESS_UPDATED_EVENT_TYPE = 'progress_updated';
const JOB_SORT_FIELD_SET = new Set<string>(JOB_SORT_FIELDS);
const JOB_STATUS_SET = new Set<string>(Object.values(JobStatus));

@Injectable()
export class JobsService {
  constructor(@Inject(DRIZZLE) private readonly db: JobsDatabase) {}

  async getJob(jobId: string, context: JobContext = {}): Promise<JobDto> {
    const job = await this.getAccessibleJob(jobId, context, 'view');
    const progressByJobId = await this.loadProgressByJobIds([job.id]);

    return toJobDto(job, progressByJobId.get(job.id) ?? null);
  }

  async getJobEvents(
    jobId: string,
    context: JobContext = {},
    query: JobEventsQueryDto = new JobEventsQueryDto(),
  ): Promise<JobEventDto[]> {
    const job = await this.getAccessibleJob(jobId, context, 'view');
    const events = await this.db
      .select()
      .from(job_events)
      .where(eq(job_events.job_id, job.id))
      .orderBy(asc(job_events.created_at))
      .limit(query.limit)
      .offset(query.offset);

    return events.map(toJobEventDto);
  }

  async cancelJob(jobId: string, context: JobContext = {}): Promise<CancelJobResponseDto> {
    return this.cancelJobInternal(jobId, context, 0);
  }

  private async cancelJobInternal(
    jobId: string,
    context: JobContext,
    retryCount: number,
  ): Promise<CancelJobResponseDto> {
    const actorUserId = resolveContextUserId(context);
    const job = await this.getAccessibleJob(jobId, context, 'cancel');
    const jobStatus = normalizeJobStatus(job.status);

    if (jobStatus === JobStatus.CANCELLED) {
      return toCancelJobResponse(job);
    }

    if (jobStatus === JobStatus.SUCCEEDED || jobStatus === JobStatus.FAILED) {
      throwJobConflict('Job is already in a terminal state');
    }

    if (jobStatus === JobStatus.RUNNING && job.cancel_requested_at !== null) {
      return toCancelJobResponse(job);
    }

    try {
      return await this.db.transaction(async (tx) => {
        const txDb = tx as JobsDatabase;

        if (jobStatus === JobStatus.PENDING) {
          const completedAt = new Date();
          const cancelledJob = await JobStateMachine.transition(
            txDb,
            job.id,
            JobStatus.PENDING,
            JobStatus.CANCELLED,
            {
              completed_at: completedAt,
            },
          );

          await JobEventRepository.create(txDb, {
            job_id: job.id,
            event_type: 'status_changed',
            detail_json: {
              from: JobStatus.PENDING,
              to: JobStatus.CANCELLED,
              requested_by: actorUserId,
            },
          });

          return toCancelJobResponse(cancelledJob);
        }

        if (jobStatus !== JobStatus.RUNNING) {
          throw new JobConflictError(`Unsupported job status for cancellation: ${job.status}`);
        }

        const cancelRequestedAt = new Date();
        const [updated] = await txDb
          .update(jobs)
          .set({
            cancel_requested_at: cancelRequestedAt,
          })
          .where(
            and(
              eq(jobs.id, job.id),
              eq(jobs.status, JobStatus.RUNNING),
              isNull(jobs.cancel_requested_at),
            ),
          )
          .returning();

        if (updated === undefined) {
          throw new JobConflictError(`Job ${job.id} changed while cancellation was requested`);
        }

        await JobEventRepository.create(txDb, {
          job_id: job.id,
          event_type: 'cancel_requested',
          detail_json: {
            requested_by: actorUserId,
          },
        });

        return toCancelJobResponse(updated);
      });
    } catch (err) {
      if (err instanceof JobConflictError) {
        return this.resolveCancellationConflict(jobId, context, retryCount);
      }

      throw err;
    }
  }

  async listAdminJobs(
    query: AdminJobListQueryDto,
    context: JobContext = {},
  ): Promise<PaginatedResponse<JobDto>> {
    const tenantId = resolveTenantId(context);
    const result = await JobRepository.findByFilter(this.db, {
      tenant_id: tenantId,
      ...(normalizeFilterValue(query.type) !== undefined ? { type: query.type } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(normalizeFilterValue(query.space_id) !== undefined ? { space_id: query.space_id } : {}),
      page: query.page,
      perPage: query.per_page,
      sort: parseJobSort(query.sort ?? '-created_at'),
    });
    const progressByJobId = await this.loadProgressByJobIds(
      result.items.map((item: JobRow) => item.id),
    );

    return paginatedResponse(
      result.items.map((item: JobRow) => toJobDto(item, progressByJobId.get(item.id) ?? null)),
      buildPaginationMeta(result.page, result.perPage, result.total),
    );
  }

  private async getAccessibleJob(
    jobId: string,
    context: JobContext,
    mode: JobAccessMode,
  ): Promise<JobRow> {
    const tenantId = resolveTenantId(context);
    const userId = resolveContextUserId(context);
    const job = await JobRepository.findById(this.db, jobId);

    if (job === undefined || job.tenant_id !== tenantId) {
      throwJobNotFound();
    }

    if (job.created_by === userId || hasImplicitSpaceAccess(context.actorRole)) {
      return job;
    }

    if (mode === 'view' && hasAuditViewAccess(context.actorRole, context.actorPermissions)) {
      return job;
    }

    if (job.space_id === null) {
      throwJobNotFound();
    }

    const permissions =
      mode === 'cancel' ? [...CANCEL_SATISFYING_PERMISSIONS] : [...VIEW_SATISFYING_PERMISSIONS];
    const allowed = await this.hasSpacePermission(tenantId, userId, job.space_id, permissions);

    if (!allowed) {
      throwJobNotFound();
    }

    return job;
  }

  private async hasSpacePermission(
    tenantId: string,
    userId: string,
    spaceId: string,
    permissions: string[],
  ): Promise<boolean> {
    const rows = await this.db
      .select({
        permission: space_permissions.permission,
      })
      .from(group_members)
      .innerJoin(
        space_permissions,
        and(
          eq(space_permissions.tenant_id, group_members.tenant_id),
          eq(space_permissions.group_id, group_members.group_id),
        ),
      )
      .where(
        and(
          eq(group_members.tenant_id, tenantId),
          eq(group_members.user_id, userId),
          eq(space_permissions.space_id, spaceId),
          inArray(space_permissions.permission, permissions),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  private async loadProgressByJobIds(jobIds: string[]): Promise<Map<string, JobProgressDto | null>> {
    if (jobIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .select()
      .from(job_events)
      .where(
        and(
          inArray(job_events.job_id, jobIds),
          eq(job_events.event_type, PROGRESS_UPDATED_EVENT_TYPE),
        ),
      )
      .orderBy(desc(job_events.created_at));

    const progressByJobId = new Map<string, JobProgressDto | null>();

    for (const row of rows) {
      if (progressByJobId.has(row.job_id)) {
        continue;
      }

      progressByJobId.set(row.job_id, toJobProgress(row.detail_json));
    }

    return progressByJobId;
  }

  private async resolveCancellationConflict(
    jobId: string,
    context: JobContext,
    retryCount: number,
  ): Promise<CancelJobResponseDto> {
    const current = await this.getAccessibleJob(jobId, context, 'cancel');
    const currentStatus = normalizeJobStatus(current.status);

    if (currentStatus === JobStatus.CANCELLED) {
      return toCancelJobResponse(current);
    }

    if (currentStatus === JobStatus.RUNNING && current.cancel_requested_at !== null) {
      return toCancelJobResponse(current);
    }

    if (currentStatus === JobStatus.SUCCEEDED || currentStatus === JobStatus.FAILED) {
      throwJobConflict('Job is already in a terminal state');
    }

    if (
      (currentStatus === JobStatus.PENDING || currentStatus === JobStatus.RUNNING) &&
      retryCount < MAX_CANCELLATION_RETRIES
    ) {
      return this.cancelJobInternal(jobId, context, retryCount + 1);
    }

    throwJobConflict('Job state changed while cancellation was requested');
  }
}

function parseJobSort(sort: string): ParsedJobSort {
  const parsed = parseSortSafely(sort);

  if (!isJobSortField(parsed.field)) {
    throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid sort field', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  return {
    field: parsed.field,
    direction: parsed.direction,
  };
}

function parseSortSafely(sort: string): ReturnType<typeof parseSortField> {
  try {
    return parseSortField(sort);
  } catch {
    throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid sort field', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

function resolveTenantId(context: JobContext): string {
  if (context.tenantId !== undefined && context.tenantId.trim().length > 0) {
    return context.tenantId.trim();
  }

  throwApiError(ErrorCode.UNAUTHENTICATED, 'Unauthenticated', HttpStatus.UNAUTHORIZED);
}

function resolveContextUserId(context: JobContext): string {
  const userId = context.userId ?? context.actorUserId;
  if (userId !== undefined && userId.trim().length > 0) {
    return userId.trim();
  }

  throwApiError(ErrorCode.UNAUTHENTICATED, 'Unauthenticated', HttpStatus.UNAUTHORIZED);
}

function hasImplicitSpaceAccess(role: string | undefined): boolean {
  const normalizedRole = role === undefined ? undefined : normalizeRole(role);
  return normalizedRole === ROLES.OWNER || normalizedRole === ROLES.ADMIN;
}

function hasAuditViewAccess(role: string | undefined, permissions: string[] | undefined): boolean {
  if (permissions?.includes(AUDIT_VIEW_PERMISSION) === true) {
    return true;
  }

  const normalizedRole = role === undefined ? undefined : normalizeRole(role);
  if (normalizedRole === undefined) {
    return false;
  }

  const rolePermissions = ROLE_PERMISSIONS[normalizedRole] as readonly string[];
  return rolePermissions.includes(AUDIT_VIEW_PERMISSION);
}

function normalizeFilterValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeJobStatus(status: string): JobStatus | undefined {
  return JOB_STATUS_SET.has(status) ? (status as JobStatus) : undefined;
}

function isJobSortField(field: string): field is JobSortField {
  return JOB_SORT_FIELD_SET.has(field);
}

function toJobDto(job: JobRow, progress: JobProgressDto | null): JobDto {
  return {
    job_id: job.id,
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

function toJobProgress(detail: unknown): JobProgressDto | null {
  if (typeof detail !== 'object' || detail === null) {
    return null;
  }

  const detailRecord = detail as Record<string, unknown>;
  const progress: JobProgressDto = {};

  if (typeof detailRecord.percent === 'number' && Number.isFinite(detailRecord.percent)) {
    progress.percent = Math.trunc(detailRecord.percent);
  }

  if (typeof detailRecord.stage === 'string' && detailRecord.stage.trim().length > 0) {
    progress.stage = detailRecord.stage;
  }

  return progress.percent === undefined && progress.stage === undefined ? null : progress;
}

function toJobEventDto(jobEvent: JobEventRow): JobEventDto {
  return {
    event: jobEvent.event_type,
    timestamp: jobEvent.created_at,
    detail: jobEvent.detail_json,
  };
}

function toCancelJobResponse(job: JobRow): CancelJobResponseDto {
  return {
    job_id: job.id,
    status: job.status,
    cancel_requested_at: job.cancel_requested_at,
  };
}

function throwJobNotFound(): never {
  throwApiError(ErrorCode.NOT_FOUND, 'Job not found', HttpStatus.NOT_FOUND);
}

function throwJobConflict(message: string): never {
  throwApiError(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT);
}

function throwApiError(code: ErrorCode, message: string, status: HttpStatus): never {
  throw new HttpException({ code, message }, status);
}
