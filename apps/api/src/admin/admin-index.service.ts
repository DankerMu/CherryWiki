import { HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import {
  JobRepository,
  QueueFactory,
  QUEUE_INDEXING,
  jobs,
  type BullMQConnection,
  type JobRow,
} from '@cherrygraph/job-core';
import { ErrorCode, indexSnapshots, spaces } from '@cherrygraph/shared';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { AuditService } from '../audit/audit.service.js';
import { REDIS_CLIENT, type OptionalRedisClient } from '../common/redis/redis.module.js';
import { DRIZZLE } from '../database/drizzle.constants.js';

type AdminIndexDatabase = NodePgDatabase;

export type AdminIndexContext = {
  tenantId: string;
  actorUserId: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
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
      throwApiError('REBUILD_ALREADY_RUNNING', 'An index rebuild is already running for this space', HttpStatus.CONFLICT);
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

    return job as JobRow | undefined;
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

function normalizeScope(scope: string | undefined): string {
  const normalized = scope?.trim();
  return normalized === undefined || normalized.length === 0 ? 'full' : normalized;
}

function throwApiError(code: ErrorCode | string, message: string, status: HttpStatus): never {
  throw new HttpException({ code, message }, status);
}
