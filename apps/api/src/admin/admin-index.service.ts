import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import {
  JobRepository,
  QueueFactory,
  QUEUE_INDEXING,
  jobs,
  type BullMQConnection,
  type JobRow,
} from '@cherrygraph/job-core';
import { ErrorCode, indexSnapshots, modelUsageLogs, retrievalTraces, spaces } from '@cherrygraph/shared';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { AuditService } from '../audit/audit.service.js';
import { throwApiError } from '../common/errors/api-error.js';
import { REDIS_CLIENT, type OptionalRedisClient } from '../common/redis/redis.module.js';
import { DRIZZLE } from '../database/drizzle.constants.js';

type AdminIndexDatabase = NodePgDatabase;
type RetrievalTraceRow = typeof retrievalTraces.$inferSelect;

export type AdminIndexContext = {
  tenantId: string;
  actorUserId: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

export type ModelUsageQueryInput = {
  start_time?: string;
  end_time?: string;
  request_type?: string;
  model_config_id?: string;
};

export type RetrievalTraceResponse = RetrievalTraceRow;

export type ModelUsageAggregate = {
  model_config_id: string;
  request_type: string;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  avg_latency_ms: number | null;
};

@Injectable()
export class AdminIndexService {
  constructor(
    @Inject(DRIZZLE) private readonly db: AdminIndexDatabase,
    private readonly auditService: AuditService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: OptionalRedisClient,
  ) {}

  async rebuildIndex(
    spaceId: string,
    input: { scope?: string; reason?: string } = {},
    context: AdminIndexContext,
    idempotencyKey?: string,
  ): Promise<JobRow> {
    const existingJob = await this.findIdempotentJob(context.tenantId, idempotencyKey);
    if (existingJob !== undefined) {
      return existingJob;
    }

    await this.assertSpaceExists(context.tenantId, spaceId);
    await this.assertNoBuildingSnapshot(context.tenantId, spaceId);

    const scope = normalizeScope(input.scope);
    const job = await JobRepository.create(this.db, {
      tenant_id: context.tenantId,
      space_id: spaceId,
      queue_name: QUEUE_INDEXING,
      type: 'reindex',
      payload_json: {
        tenant_id: context.tenantId,
        space_id: spaceId,
        trigger: 'manual_rebuild',
        scope,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      },
      ...(idempotencyKey !== undefined ? { idempotency_key: idempotencyKey } : {}),
      created_by: context.actorUserId,
    });

    await this.enqueueIndexingJob(job.id);
    this.auditService.push({
      tenant_id: context.tenantId,
      actor_user_id: context.actorUserId,
      action: 'admin.index.rebuild',
      resource_type: 'space',
      resource_id: spaceId,
      space_id: spaceId,
      ...(context.ip !== undefined ? { ip: context.ip } : {}),
      ...(context.userAgent !== undefined ? { user_agent: context.userAgent } : {}),
      ...(context.requestId !== undefined ? { request_id: context.requestId } : {}),
      metadata_json: {
        reindex_job_id: job.id,
        trigger: 'manual_rebuild',
        scope,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      },
    });

    return job;
  }

  async getRetrievalTrace(traceId: string, context: AdminIndexContext): Promise<RetrievalTraceResponse> {
    const [trace] = await this.db
      .select()
      .from(retrievalTraces)
      .where(and(eq(retrievalTraces.tenant_id, context.tenantId), eq(retrievalTraces.id, traceId)))
      .limit(1);

    if (trace === undefined) {
      throwApiError(ErrorCode.RETRIEVAL_TRACE_NOT_FOUND, 'Retrieval trace not found', HttpStatus.NOT_FOUND);
    }

    return trace;
  }

  async getModelUsage(
    input: ModelUsageQueryInput = {},
    context: AdminIndexContext,
  ): Promise<ModelUsageAggregate[]> {
    const filters = buildModelUsageFilters(context.tenantId, input);
    const rows = await this.db
      .select({
        model_config_id: modelUsageLogs.model_config_id,
        request_type: modelUsageLogs.request_type,
        request_count: sql<number>`count(*)::int`,
        input_tokens: sql<number>`coalesce(sum(${modelUsageLogs.input_tokens}), 0)::int`,
        output_tokens: sql<number>`coalesce(sum(${modelUsageLogs.output_tokens}), 0)::int`,
        total_tokens: sql<number>`coalesce(sum(${modelUsageLogs.input_tokens} + ${modelUsageLogs.output_tokens}), 0)::int`,
        avg_latency_ms: sql<number | null>`round(avg(${modelUsageLogs.latency_ms}))::int`,
      })
      .from(modelUsageLogs)
      .where(and(...filters))
      .groupBy(modelUsageLogs.model_config_id, modelUsageLogs.request_type)
      .orderBy(desc(sql`coalesce(sum(${modelUsageLogs.input_tokens} + ${modelUsageLogs.output_tokens}), 0)`));

    return rows.map((row) => ({
      model_config_id: row.model_config_id,
      request_type: row.request_type,
      request_count: normalizeAggregateNumber(row.request_count),
      input_tokens: normalizeAggregateNumber(row.input_tokens),
      output_tokens: normalizeAggregateNumber(row.output_tokens),
      total_tokens: normalizeAggregateNumber(row.total_tokens),
      avg_latency_ms: row.avg_latency_ms === null ? null : normalizeAggregateNumber(row.avg_latency_ms),
    }));
  }

  private async assertSpaceExists(tenantId: string, spaceId: string): Promise<void> {
    const [space] = await this.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.id, spaceId)))
      .limit(1);

    if (space === undefined) {
      throwApiError(ErrorCode.SPACE_NOT_FOUND, 'Space not found', HttpStatus.NOT_FOUND);
    }
  }

  private async assertNoBuildingSnapshot(tenantId: string, spaceId: string): Promise<void> {
    const [existing] = await this.db
      .select({ id: indexSnapshots.id })
      .from(indexSnapshots)
      .where(
        and(
          eq(indexSnapshots.tenant_id, tenantId),
          eq(indexSnapshots.space_id, spaceId),
          eq(indexSnapshots.status, 'building'),
        ),
      )
      .limit(1);

    if (existing !== undefined) {
      throwApiError(ErrorCode.REBUILD_ALREADY_RUNNING, 'An index rebuild is already running for this space', HttpStatus.CONFLICT);
    }
  }

  private async findIdempotentJob(tenantId: string, idempotencyKey: string | undefined): Promise<JobRow | undefined> {
    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      return undefined;
    }

    const [job] = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenant_id, tenantId), eq(jobs.idempotency_key, idempotencyKey)))
      .limit(1);

    return job;
  }

  private async enqueueIndexingJob(jobId: string): Promise<void> {
    const queue = QueueFactory.createQueue<{ jobId: string }>(QUEUE_INDEXING, this.getRequiredRedis());
    try {
      await queue.add('reindex', { jobId });
    } finally {
      await queue.close();
    }
  }

  private getRequiredRedis(): BullMQConnection {
    if (this.redis === undefined) {
      throwApiError(ErrorCode.INTERNAL_ERROR, 'Redis is not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return this.redis;
  }
}

function buildModelUsageFilters(tenantId: string, input: ModelUsageQueryInput): SQL[] {
  const filters: SQL[] = [eq(modelUsageLogs.tenant_id, tenantId)];

  if (input.start_time !== undefined && input.start_time.trim().length > 0) {
    filters.push(gte(modelUsageLogs.created_at, parseDateOrThrow(input.start_time, 'start_time')));
  }

  if (input.end_time !== undefined && input.end_time.trim().length > 0) {
    filters.push(lte(modelUsageLogs.created_at, parseDateOrThrow(input.end_time, 'end_time')));
  }

  if (input.request_type !== undefined && input.request_type.trim().length > 0) {
    filters.push(eq(modelUsageLogs.request_type, input.request_type.trim()));
  }

  if (input.model_config_id !== undefined && input.model_config_id.trim().length > 0) {
    filters.push(eq(modelUsageLogs.model_config_id, input.model_config_id.trim()));
  }

  return filters;
}

function parseDateOrThrow(value: string, fieldName: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throwApiError(ErrorCode.VALIDATION_ERROR, `Invalid ${fieldName}`, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  return parsed;
}

function normalizeAggregateNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

const VALID_REBUILD_SCOPES = new Set(['full', 'incremental']);

function normalizeScope(scope: string | undefined): string {
  const normalized = scope?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return 'full';
  }

  if (!VALID_REBUILD_SCOPES.has(normalized)) {
    throwApiError(ErrorCode.INVALID_SCOPE, `Invalid rebuild scope: ${normalized}. Must be 'full' or 'incremental'.`, HttpStatus.BAD_REQUEST);
  }

  return normalized;
}
