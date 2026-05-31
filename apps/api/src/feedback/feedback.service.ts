import { HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import {
  JobRepository,
  QueueFactory,
  QUEUE_INDEXING,
  type BullMQConnection,
  type JobRow,
} from '@cherrygraph/job-core';
import {
  ErrorCode,
  answerCitations,
  conflictItemDto,
  feedbackCreateDto,
  feedbackItems,
  feedbackResolveDto,
  feedbackStatusSchema,
  feedbackTypeSchema,
  wikiPages,
  type FeedbackCreateDto,
  type FeedbackResolveDto,
} from '@cherrygraph/shared';
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';

import { AuditService } from '../audit/audit.service.js';
import { throwApiError } from '../common/errors/api-error.js';
import { REDIS_CLIENT, type OptionalRedisClient } from '../common/redis/redis.module.js';
import { DRIZZLE } from '../database/drizzle.constants.js';

type FeedbackDatabase = NodePgDatabase;
type FeedbackRow = typeof feedbackItems.$inferSelect;
type FeedbackInsert = typeof feedbackItems.$inferInsert;
type JsonRecord = Record<string, unknown>;

export type FeedbackAuditContext = {
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

export type FeedbackActorContext = {
  tenantId: string;
  actorUserId: string;
  audit?: FeedbackAuditContext;
};

export type CreateFeedbackContext = FeedbackActorContext & {
  spaceId: string;
};

export type ConflictFeedbackInput = {
  conflict_type: 'contradictory_edges' | 'edge_chunk_mismatch';
  entity_pair: {
    source_node_id: string;
    target_node_id: string;
    source_label: string;
    target_label: string;
  };
  conflicting_items: JsonRecord[];
  severity: 'high' | 'medium' | 'low';
  fingerprint: string;
};

export type ListFeedbackInput = {
  status?: string;
  feedback_type?: string;
  space_id?: string;
  user_id?: string;
  cursor?: string;
  limit?: number;
};

export type FeedbackListPage = {
  items: FeedbackRow[];
  next_cursor: string | null;
  has_next: boolean;
  limit: number;
};

type FeedbackCursor = {
  createdAt: Date;
  id: string;
};

type ReindexCandidatePage = {
  id: string;
  page_id: string;
  space_id: string;
  updated_at: Date;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class FeedbackService {
  constructor(
    @Inject(DRIZZLE) private readonly db: FeedbackDatabase,
    private readonly auditService: AuditService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: OptionalRedisClient,
  ) {}

  async createFeedback(input: unknown, context: CreateFeedbackContext): Promise<FeedbackRow> {
    const parsed = parseCreateInput(input);
    const id = randomUUID();
    const now = new Date();
    const messageId = normalizeOptionalString(parsed.message_id);
    const payloadJson = normalizePayload(parsed.payload_json);

    const [created] = await this.db
      .insert(feedbackItems)
      .values({
        id,
        tenant_id: context.tenantId,
        user_id: context.actorUserId,
        message_id: messageId,
        space_id: context.spaceId,
        feedback_type: parsed.feedback_type,
        status: 'open',
        payload_json: payloadJson,
        created_at: now,
      } satisfies FeedbackInsert)
      .returning();

    if (created === undefined) {
      throw new Error('Failed to create feedback');
    }

    this.auditService.push({
      tenant_id: context.tenantId,
      actor_user_id: context.actorUserId,
      action: 'feedback.created',
      resource_type: 'feedback_item',
      resource_id: created.id,
      space_id: context.spaceId,
      ...toAuditFields(context.audit),
      metadata_json: {
        feedback_type: created.feedback_type,
        message_id: created.message_id,
        page_id: readPageId(created.payload_json),
      },
    });

    return created;
  }

  async createConflictFeedback(input: ConflictFeedbackInput, context: CreateFeedbackContext): Promise<FeedbackRow> {
    const parsed = conflictItemDto.safeParse(input);
    if (!parsed.success) {
      throwValidationError(parsed.error);
    }

    const id = randomUUID();
    const now = new Date();
    const payloadJson = { ...input };
    const [created] = await this.db
      .insert(feedbackItems)
      .values({
        id,
        tenant_id: context.tenantId,
        user_id: context.actorUserId,
        message_id: null,
        space_id: context.spaceId,
        feedback_type: 'conflict',
        status: 'open',
        payload_json: payloadJson,
        created_at: now,
      } satisfies FeedbackInsert)
      .returning();

    if (created === undefined) {
      throw new Error('Failed to create conflict feedback');
    }

    this.auditService.push({
      tenant_id: context.tenantId,
      actor_user_id: context.actorUserId,
      action: 'feedback.created',
      resource_type: 'feedback_item',
      resource_id: created.id,
      space_id: context.spaceId,
      ...toAuditFields(context.audit),
      metadata_json: {
        feedback_type: 'conflict',
        conflict_type: input.conflict_type,
        severity: input.severity,
        fingerprint: input.fingerprint,
      },
    });

    return created;
  }

  async listFeedback(input: ListFeedbackInput, context: FeedbackActorContext): Promise<FeedbackListPage> {
    const limit = normalizeLimit(input.limit);
    const cursor = parseCursor(input.cursor);
    const filters = buildListFilters(context.tenantId, input, cursor);

    const rows = await this.db
      .select()
      .from(feedbackItems)
      .where(and(...filters))
      .orderBy(desc(feedbackItems.created_at), desc(feedbackItems.id))
      .limit(limit + 1);

    const hasNext = rows.length > limit;
    const items = hasNext ? rows.slice(0, limit) : rows;
    const lastItem = items.at(-1);

    return {
      items,
      next_cursor: hasNext && lastItem !== undefined ? encodeCursor(lastItem) : null,
      has_next: hasNext,
      limit,
    };
  }

  async resolveFeedback(feedbackId: string, input: unknown, context: FeedbackActorContext): Promise<FeedbackRow> {
    const parsed = parseResolveInput(input);
    const existing = await this.findFeedback(feedbackId, context.tenantId);

    if (existing === undefined) {
      throwApiError(ErrorCode.FEEDBACK_NOT_FOUND, 'Feedback item not found', HttpStatus.NOT_FOUND);
    }

    if (existing.status !== 'open') {
      throwApiError(ErrorCode.FEEDBACK_ALREADY_RESOLVED, 'Feedback item is already resolved', HttpStatus.CONFLICT);
    }

    const resolutionNote = `${parsed.resolution}: ${parsed.notes?.trim() ?? ''}`;
    const resolvedAt = new Date();
    const [updated] = await this.db
      .update(feedbackItems)
      .set({
        status: 'resolved',
        resolved_by: context.actorUserId,
        resolved_at: resolvedAt,
        resolution_note: resolutionNote,
      } satisfies Partial<FeedbackInsert>)
      .where(and(eq(feedbackItems.tenant_id, context.tenantId), eq(feedbackItems.id, feedbackId), eq(feedbackItems.status, 'open')))
      .returning();

    if (updated === undefined) {
      throwApiError(ErrorCode.FEEDBACK_ALREADY_RESOLVED, 'Feedback item is already resolved', HttpStatus.CONFLICT);
    }

    this.auditService.push({
      tenant_id: context.tenantId,
      actor_user_id: context.actorUserId,
      action: 'feedback.resolved',
      resource_type: 'feedback_item',
      resource_id: updated.id,
      ...(updated.space_id !== null ? { space_id: updated.space_id } : {}),
      ...toAuditFields(context.audit),
      metadata_json: {
        resolution: parsed.resolution,
        has_notes: parsed.notes !== undefined && parsed.notes.trim().length > 0,
      },
    });

    await this.triggerReindexIfNeeded(updated, context);
    return updated;
  }

  private async findFeedback(feedbackId: string, tenantId: string): Promise<FeedbackRow | undefined> {
    const [row] = await this.db
      .select()
      .from(feedbackItems)
      .where(and(eq(feedbackItems.tenant_id, tenantId), eq(feedbackItems.id, feedbackId)))
      .limit(1);

    return row;
  }

  private async triggerReindexIfNeeded(
    feedback: FeedbackRow,
    context: FeedbackActorContext,
  ): Promise<JobRow | undefined> {
    const page = await this.findAssociatedPage(feedback, context.tenantId);
    if (page === undefined || feedback.space_id === null || !isAfter(page.updated_at, feedback.created_at)) {
      return undefined;
    }

    const job = await JobRepository.create(this.db, {
      tenant_id: context.tenantId,
      space_id: page.space_id,
      queue_name: QUEUE_INDEXING,
      type: 'reindex',
      payload_json: {
        tenant_id: context.tenantId,
        space_id: page.space_id,
        page_id: page.page_id,
        wiki_page_pk: page.id,
        feedback_id: feedback.id,
        trigger: 'feedback_resolved',
        scope: 'single_page',
      },
      created_by: context.actorUserId,
    });

    await this.enqueueIndexingJob(job.id);
    return job;
  }

  private async findAssociatedPage(
    feedback: FeedbackRow,
    tenantId: string,
  ): Promise<ReindexCandidatePage | undefined> {
    const pageId = readPageId(feedback.payload_json);
    if (pageId !== undefined && feedback.space_id !== null) {
      const [page] = await this.db
        .select({
          id: wikiPages.id,
          page_id: wikiPages.page_id,
          space_id: wikiPages.space_id,
          updated_at: wikiPages.updated_at,
        })
        .from(wikiPages)
        .where(
          and(
            eq(wikiPages.tenant_id, tenantId),
            eq(wikiPages.space_id, feedback.space_id),
            or(eq(wikiPages.page_id, pageId), eq(wikiPages.id, pageId)),
          ),
        )
        .limit(1);

      return page;
    }

    if (feedback.message_id === null || feedback.space_id === null) {
      return undefined;
    }

    const [page] = await this.db
      .select({
        id: wikiPages.id,
        page_id: wikiPages.page_id,
        space_id: wikiPages.space_id,
        updated_at: wikiPages.updated_at,
      })
      .from(answerCitations)
      .innerJoin(wikiPages, eq(answerCitations.wiki_page_pk, wikiPages.id))
      .where(
        and(
          eq(answerCitations.message_id, feedback.message_id),
          eq(wikiPages.tenant_id, tenantId),
          eq(wikiPages.space_id, feedback.space_id),
        ),
      )
      .orderBy(desc(wikiPages.updated_at))
      .limit(1);

    return page;
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

function parseCreateInput(input: unknown): FeedbackCreateDto {
  const parsed = feedbackCreateDto.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  if (isTargetRequiredError(parsed.error)) {
    throwApiError(
      ErrorCode.FEEDBACK_TARGET_REQUIRED,
      'Either message_id or payload_json.page_id is required',
      HttpStatus.BAD_REQUEST,
    );
  }

  throwValidationError(parsed.error);
}

function parseResolveInput(input: unknown): FeedbackResolveDto {
  const parsed = feedbackResolveDto.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  throwValidationError(parsed.error);
}

function isTargetRequiredError(error: ZodError): boolean {
  return error.issues.some((issue) => issue.message === 'Either message_id or payload_json.page_id is required');
}

function throwValidationError(error: ZodError): never {
  throw new HttpException(
    {
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function normalizePayload(payload: JsonRecord): JsonRecord {
  return { ...payload };
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? null : normalized;
}

function readPageId(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const pageId = payload.page_id;
  return typeof pageId === 'string' && pageId.trim().length > 0 ? pageId.trim() : undefined;
}

function buildListFilters(tenantId: string, input: ListFeedbackInput, cursor: FeedbackCursor | undefined): SQL[] {
  const filters: SQL[] = [eq(feedbackItems.tenant_id, tenantId)];

  if (input.status !== undefined && input.status.trim().length > 0) {
    const parsed = feedbackStatusSchema.safeParse(input.status);
    if (!parsed.success) {
      throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid feedback status', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    filters.push(eq(feedbackItems.status, parsed.data));
  }

  if (input.feedback_type !== undefined && input.feedback_type.trim().length > 0) {
    const parsed = feedbackTypeSchema.safeParse(input.feedback_type);
    if (!parsed.success) {
      throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid feedback type', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    filters.push(eq(feedbackItems.feedback_type, parsed.data));
  }

  if (input.space_id !== undefined && input.space_id.trim().length > 0) {
    filters.push(eq(feedbackItems.space_id, input.space_id.trim()));
  }

  if (input.user_id !== undefined && input.user_id.trim().length > 0) {
    filters.push(eq(feedbackItems.user_id, input.user_id.trim()));
  }

  if (cursor !== undefined) {
    filters.push(
      or(
        lt(feedbackItems.created_at, cursor.createdAt),
        and(eq(feedbackItems.created_at, cursor.createdAt), lt(feedbackItems.id, cursor.id)),
      ) as SQL,
    );
  }

  return filters;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function encodeCursor(row: FeedbackRow): string {
  return Buffer.from(
    JSON.stringify({
      created_at: row.created_at.toISOString(),
      id: row.id,
    }),
  ).toString('base64url');
}

function parseCursor(cursor: string | undefined): FeedbackCursor | undefined {
  if (cursor === undefined || cursor.trim().length === 0) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!isRecord(decoded) || typeof decoded.id !== 'string' || typeof decoded.created_at !== 'string') {
      throw new Error('Invalid cursor payload');
    }

    const createdAt = new Date(decoded.created_at);
    if (Number.isNaN(createdAt.getTime()) || decoded.id.trim().length === 0) {
      throw new Error('Invalid cursor values');
    }

    return {
      createdAt,
      id: decoded.id,
    };
  } catch {
    throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid cursor', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

function isAfter(left: Date, right: Date): boolean {
  return left.getTime() > right.getTime();
}

function toAuditFields(audit: FeedbackAuditContext | undefined): Pick<
  Parameters<AuditService['push']>[0],
  'ip' | 'user_agent' | 'request_id'
> {
  return {
    ...(audit?.ip !== undefined ? { ip: audit.ip } : {}),
    ...(audit?.userAgent !== undefined ? { user_agent: audit.userAgent } : {}),
    ...(audit?.requestId !== undefined ? { request_id: audit.requestId } : {}),
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
