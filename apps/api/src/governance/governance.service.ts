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
  feedbackItems,
  governanceEdgeReviewDto,
  governanceMergeDto,
  graphEdges,
  graphNodeMerges,
  graphNodes,
  wikiPages,
} from '@cherrygraph/shared';
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import type { ZodError } from 'zod';

import { AuditService } from '../audit/audit.service.js';
import { REDIS_CLIENT, type OptionalRedisClient } from '../common/redis/redis.module.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { FeedbackService, type ConflictFeedbackInput } from '../feedback/feedback.service.js';
import {
  detectContradictoryEdgeConflicts,
  detectEdgeChunkMismatchConflicts,
  type ConflictEdgeRow,
  type DetectedConflict,
  type EdgeChunkMismatchRow,
} from './conflict-detection.js';

type GovernanceDatabase = NodePgDatabase;
type EdgeRow = typeof graphEdges.$inferSelect;
type GraphNodeMergeInsert = typeof graphNodeMerges.$inferInsert;
type WikiPageRow = typeof wikiPages.$inferSelect;
type JsonRecord = Record<string, unknown>;

export type GovernanceAuditContext = {
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

export type GovernanceActorContext = {
  tenantId: string;
  actorUserId: string;
  audit?: GovernanceAuditContext;
};

export type LowConfidenceEdgesInput = {
  threshold?: number;
  space_id?: string;
  limit?: number;
  offset?: number;
  page?: number;
};

export type LowConfidenceEdgeItem = {
  edge_id: string;
  source_node: {
    id: string;
    label: string;
  };
  target_node: {
    id: string;
    label: string;
  };
  relation_type: string;
  effective_confidence_score: number | null;
  raw_confidence_score: number | null;
  confidence_label: string;
  evidence_count: number;
  space_id: string;
};

export type PaginatedGovernanceList<T> = {
  items: T[];
  limit: number;
  offset: number;
  has_next: boolean;
};

export type DuplicateSuggestionsInput = {
  space_id?: string;
  limit?: number;
  offset?: number;
  page?: number;
};

export type DuplicateSuggestionItem = {
  page_a_id: string;
  page_b_id: string;
  page_a_title: string;
  page_b_title: string;
  similarity_score: number;
  suggested_target: string;
};

export type EdgeReviewResult = {
  edge_id: string;
  effective_confidence_score: number | null;
  raw_confidence_score: number | null;
  confidence_label: string;
  reindex_job_id: string;
};

export type MergeResult = {
  merge_id: string;
  from_page_id: string;
  to_page_id: string;
  status: string;
  sync_status: string;
  reindex_job_id: string;
};

export type ConflictListInput = {
  space_id?: string;
  limit?: number;
  offset?: number;
  page?: number;
};

export type ConflictListItem = {
  conflict_id: string;
  conflict_type: string;
  entity_pair: unknown;
  conflicting_items: unknown[];
  severity: string;
};

type RawLowConfidenceEdgeRow = {
  edge_id: string;
  source_node_id: string;
  source_node_label: string;
  target_node_id: string;
  target_node_label: string;
  relation_type: string;
  effective_confidence_score: number | string | null;
  raw_confidence_score: number | string | null;
  confidence_label: string;
  evidence_count: number | string;
  space_id: string;
};

type RawDuplicateSuggestionRow = {
  page_a_id: string;
  page_b_id: string;
  page_a_title: string;
  page_b_title: string;
  similarity_score: number | string;
  suggested_target: string;
};

type ConflictFeedbackRow = {
  id: string;
  payload_json: unknown;
};

const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.55;
const DUPLICATE_THRESHOLD = 0.8;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class GovernanceService {
  constructor(
    @Inject(DRIZZLE) private readonly db: GovernanceDatabase,
    private readonly auditService: AuditService,
    private readonly feedbackService: FeedbackService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: OptionalRedisClient,
  ) {}

  async listLowConfidenceEdges(
    input: LowConfidenceEdgesInput,
    context: GovernanceActorContext,
  ): Promise<PaginatedGovernanceList<LowConfidenceEdgeItem>> {
    const threshold = normalizeThreshold(input.threshold);
    const pagination = normalizePagination(input);
    const filters: SQL[] = [
      sql`e.tenant_id = ${context.tenantId}`,
      sql`e.effective_confidence_score < ${threshold}`,
      sql`e.confidence_label <> 'REJECTED'`,
    ];
    const spaceId = normalizeOptionalString(input.space_id);
    if (spaceId !== undefined) {
      filters.push(sql`e.space_id = ${spaceId}`);
    }

    const result = await this.db.execute<RawLowConfidenceEdgeRow>(sql`
      select
        e.id as edge_id,
        source_node.id as source_node_id,
        source_node.label as source_node_label,
        target_node.id as target_node_id,
        target_node.label as target_node_label,
        e.relation_type,
        e.effective_confidence_score,
        e.raw_confidence_score,
        e.confidence_label,
        e.evidence_count,
        e.space_id
      from graph_edges e
      inner join graph_nodes source_node
        on source_node.id = e.source_node_id
       and source_node.tenant_id = e.tenant_id
      inner join graph_nodes target_node
        on target_node.id = e.target_node_id
       and target_node.tenant_id = e.tenant_id
      where ${sql.join(filters, sql` and `)}
      order by e.effective_confidence_score asc, e.id asc
      limit ${pagination.limit + 1}
      offset ${pagination.offset}
    `);
    const rows = rowsFromResult<RawLowConfidenceEdgeRow>(result);
    const items = rows.slice(0, pagination.limit).map(toLowConfidenceEdgeItem);

    return {
      items,
      limit: pagination.limit,
      offset: pagination.offset,
      has_next: rows.length > pagination.limit,
    };
  }

  async reviewEdge(
    edgeId: string,
    input: unknown,
    context: GovernanceActorContext,
  ): Promise<EdgeReviewResult> {
    const parsed = parseEdgeReviewInput(input);
    const existing = await this.findEdge(edgeId, context.tenantId);
    if (existing === undefined) {
      throwApiError(ErrorCode.NOT_FOUND, 'Graph edge not found', HttpStatus.NOT_FOUND);
    }

    const nextValues =
      parsed.action === 'confirm'
        ? buildConfirmedEdgeValues(parsed.effective_score)
        : {
            effective_confidence_score: 0,
            confidence_label: 'REJECTED',
          };

    const [updated] = await this.db
      .update(graphEdges)
      .set(nextValues)
      .where(and(eq(graphEdges.tenant_id, context.tenantId), eq(graphEdges.id, edgeId)))
      .returning();

    if (updated === undefined) {
      throwApiError(ErrorCode.NOT_FOUND, 'Graph edge not found', HttpStatus.NOT_FOUND);
    }

    this.auditService.push({
      tenant_id: context.tenantId,
      actor_user_id: context.actorUserId,
      action: 'governance.edge.reviewed',
      resource_type: 'graph_edge',
      resource_id: edgeId,
      space_id: existing.space_id,
      ...toAuditFields(context.audit),
      metadata_json: {
        reason: parsed.reason,
        before: {
          effective_confidence_score: existing.effective_confidence_score,
          confidence_label: existing.confidence_label,
        },
        after: {
          effective_confidence_score: updated.effective_confidence_score,
          confidence_label: updated.confidence_label,
        },
        raw_confidence_score: existing.raw_confidence_score,
      },
    });

    const job = await this.createGovernanceReindexJob(existing.space_id, context, {
      governance_action: 'edge_review',
      edge_id: edgeId,
      review_action: parsed.action,
    });

    return {
      edge_id: updated.id,
      effective_confidence_score: updated.effective_confidence_score,
      raw_confidence_score: updated.raw_confidence_score,
      confidence_label: updated.confidence_label,
      reindex_job_id: job.id,
    };
  }

  async listDuplicateSuggestions(
    input: DuplicateSuggestionsInput,
    context: GovernanceActorContext,
  ): Promise<PaginatedGovernanceList<DuplicateSuggestionItem>> {
    const pagination = normalizePagination(input);
    const filters: SQL[] = [
      sql`a.tenant_id = ${context.tenantId}`,
      sql`a.space_id = b.space_id`,
      sql`a.id < b.id`,
      sql`a.wiki_page_pk is not null`,
      sql`b.wiki_page_pk is not null`,
      sql`a.wiki_page_pk <> b.wiki_page_pk`,
      sql`similarity(a.label, b.label) >= ${DUPLICATE_THRESHOLD}`,
      sql`page_a.status <> 'merged'`,
      sql`page_b.status <> 'merged'`,
    ];
    const spaceId = normalizeOptionalString(input.space_id);
    if (spaceId !== undefined) {
      filters.push(sql`a.space_id = ${spaceId}`);
    }

    const result = await this.db.execute<RawDuplicateSuggestionRow>(sql`
      with version_counts as (
        select wiki_page_pk, count(*)::int as version_count
        from wiki_page_versions
        where tenant_id = ${context.tenantId}
        group by wiki_page_pk
      ),
      candidate_pairs as (
        select distinct on (page_a.page_id, page_b.page_id)
          page_a.page_id as page_a_id,
          page_b.page_id as page_b_id,
          page_a.title as page_a_title,
          page_b.title as page_b_title,
          similarity(a.label, b.label)::float as similarity_score,
          case
            when coalesce(count_a.version_count, 0) > coalesce(count_b.version_count, 0) then page_a.page_id
            when coalesce(count_b.version_count, 0) > coalesce(count_a.version_count, 0) then page_b.page_id
            when page_a.created_at <= page_b.created_at then page_a.page_id
            else page_b.page_id
          end as suggested_target
        from graph_nodes a
        inner join graph_nodes b
          on b.tenant_id = a.tenant_id
         and b.space_id = a.space_id
        inner join wiki_pages page_a
          on page_a.id = a.wiki_page_pk
         and page_a.tenant_id = a.tenant_id
         and page_a.space_id = a.space_id
        inner join wiki_pages page_b
          on page_b.id = b.wiki_page_pk
         and page_b.tenant_id = b.tenant_id
         and page_b.space_id = b.space_id
        left join version_counts count_a on count_a.wiki_page_pk = page_a.id
        left join version_counts count_b on count_b.wiki_page_pk = page_b.id
        where ${sql.join(filters, sql` and `)}
        order by page_a.page_id, page_b.page_id, similarity(a.label, b.label) desc
      )
      select *
      from candidate_pairs
      order by similarity_score desc, page_a_title asc, page_b_title asc
      limit ${pagination.limit + 1}
      offset ${pagination.offset}
    `);
    const rows = rowsFromResult<RawDuplicateSuggestionRow>(result);
    const items = rows.slice(0, pagination.limit).map(toDuplicateSuggestionItem);

    return {
      items,
      limit: pagination.limit,
      offset: pagination.offset,
      has_next: rows.length > pagination.limit,
    };
  }

  async mergePages(input: unknown, context: GovernanceActorContext): Promise<MergeResult> {
    const parsed = parseMergeInput(input);
    const fromPage = await this.findWikiPage(context.tenantId, parsed.from_page_id);
    const toPage = await this.findWikiPage(context.tenantId, parsed.to_page_id);
    if (fromPage === undefined || toPage === undefined) {
      throwApiError(ErrorCode.PAGE_NOT_FOUND, 'Page not found', HttpStatus.NOT_FOUND);
    }

    if (fromPage.id === toPage.id || fromPage.page_id === toPage.page_id) {
      throwApiError(ErrorCode.CANNOT_MERGE_SELF, 'Cannot merge a page into itself', HttpStatus.BAD_REQUEST);
    }

    if (fromPage.space_id !== toPage.space_id) {
      throwApiError(ErrorCode.VALIDATION_ERROR, 'Pages must belong to the same space', HttpStatus.BAD_REQUEST);
    }

    const fromStableKey = await this.findPrimaryStableKey(fromPage);
    const toStableKey = await this.findPrimaryStableKey(toPage);
    const mergeId = randomUUID();
    const syncStatus = `redirect:${toPage.page_id}`;

    await this.db.transaction(async (tx) => {
      const [merge] = await tx
        .insert(graphNodeMerges)
        .values({
          id: mergeId,
          tenant_id: context.tenantId,
          space_id: fromPage.space_id,
          from_stable_key: fromStableKey,
          to_stable_key: toStableKey,
          reason: parsed.reason,
          created_by: context.actorUserId,
          created_at: new Date(),
        } satisfies GraphNodeMergeInsert)
        .returning();

      if (merge === undefined) {
        throw new Error('Failed to create graph node merge');
      }

      const [updatedPage] = await tx
        .update(wikiPages)
        .set({
          status: 'merged',
          sync_status: syncStatus,
          updated_at: new Date(),
        })
        .where(and(eq(wikiPages.tenant_id, context.tenantId), eq(wikiPages.id, fromPage.id)))
        .returning();

      if (updatedPage === undefined) {
        throw new Error('Failed to update source page after merge');
      }
    });

    this.auditService.push({
      tenant_id: context.tenantId,
      actor_user_id: context.actorUserId,
      action: 'governance.page.merged',
      resource_type: 'wiki_page',
      resource_id: fromPage.id,
      space_id: fromPage.space_id,
      ...toAuditFields(context.audit),
      metadata_json: {
        from_page_id: fromPage.page_id,
        to_page_id: toPage.page_id,
        reason: parsed.reason,
        merge_id: mergeId,
      },
    });

    const job = await this.createGovernanceReindexJob(fromPage.space_id, context, {
      governance_action: 'page_merge',
      from_page_id: fromPage.page_id,
      to_page_id: toPage.page_id,
      merge_id: mergeId,
    });

    return {
      merge_id: mergeId,
      from_page_id: fromPage.page_id,
      to_page_id: toPage.page_id,
      status: 'merged',
      sync_status: syncStatus,
      reindex_job_id: job.id,
    };
  }

  async detectAndPersistConflicts(
    input: ConflictListInput,
    context: GovernanceActorContext,
  ): Promise<DetectedConflict[]> {
    const existingFingerprints = await this.listAllConflictFingerprints(input, context);
    const conflicts = [
      ...detectContradictoryEdgeConflicts(await this.fetchConflictEdgeRows(input, context)),
      ...detectEdgeChunkMismatchConflicts(await this.fetchEdgeChunkMismatchRows(input, context)),
    ];
    const created: DetectedConflict[] = [];

    for (const conflict of conflicts) {
      if (existingFingerprints.has(conflict.fingerprint)) {
        continue;
      }

      await this.feedbackService.createConflictFeedback(toConflictFeedbackInput(conflict), {
        tenantId: context.tenantId,
        actorUserId: context.actorUserId,
        spaceId: conflict.space_id,
        ...(context.audit !== undefined ? { audit: context.audit } : {}),
      });
      existingFingerprints.add(conflict.fingerprint);
      created.push(conflict);
    }

    return created;
  }

  async listConflicts(
    input: ConflictListInput,
    context: GovernanceActorContext,
  ): Promise<PaginatedGovernanceList<ConflictListItem>> {
    await this.detectAndPersistConflicts(input, context);

    const pagination = normalizePagination(input);
    const filters = [
      eq(feedbackItems.tenant_id, context.tenantId),
      eq(feedbackItems.feedback_type, 'conflict'),
      eq(feedbackItems.status, 'open'),
    ];
    const spaceId = normalizeOptionalString(input.space_id);
    if (spaceId !== undefined) {
      filters.push(eq(feedbackItems.space_id, spaceId));
    }

    const rows = await this.db
      .select({ id: feedbackItems.id, payload_json: feedbackItems.payload_json })
      .from(feedbackItems)
      .where(and(...filters))
      .orderBy(desc(feedbackItems.created_at), desc(feedbackItems.id))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const items = rows.slice(0, pagination.limit).map(toConflictListItem);

    return {
      items,
      limit: pagination.limit,
      offset: pagination.offset,
      has_next: rows.length > pagination.limit,
    };
  }

  private async findEdge(edgeId: string, tenantId: string): Promise<EdgeRow | undefined> {
    const [edge] = await this.db
      .select()
      .from(graphEdges)
      .where(and(eq(graphEdges.tenant_id, tenantId), eq(graphEdges.id, edgeId)))
      .limit(1);

    return edge;
  }

  private async findWikiPage(tenantId: string, pageId: string): Promise<WikiPageRow | undefined> {
    const [page] = await this.db
      .select()
      .from(wikiPages)
      .where(and(eq(wikiPages.tenant_id, tenantId), or(eq(wikiPages.page_id, pageId), eq(wikiPages.id, pageId))))
      .limit(1);

    return page;
  }

  private async findPrimaryStableKey(page: WikiPageRow): Promise<string> {
    const [node] = await this.db
      .select({ stable_key: graphNodes.stable_key })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.tenant_id, page.tenant_id),
          eq(graphNodes.space_id, page.space_id),
          eq(graphNodes.wiki_page_pk, page.id),
        ),
      )
      .orderBy(desc(graphNodes.created_at))
      .limit(1);

    return node?.stable_key ?? page.page_id;
  }

  private async listAllConflictFingerprints(
    input: ConflictListInput,
    context: GovernanceActorContext,
  ): Promise<Set<string>> {
    const filters = [
      eq(feedbackItems.tenant_id, context.tenantId),
      eq(feedbackItems.feedback_type, 'conflict'),
    ];
    const spaceId = normalizeOptionalString(input.space_id);
    if (spaceId !== undefined) {
      filters.push(eq(feedbackItems.space_id, spaceId));
    }

    const rows = await this.db
      .select({ payload_json: feedbackItems.payload_json })
      .from(feedbackItems)
      .where(and(...filters));

    return new Set(
      rows
        .map((row) => readFingerprint(row.payload_json))
        .filter((fingerprint): fingerprint is string => fingerprint !== undefined),
    );
  }

  private async fetchConflictEdgeRows(
    input: ConflictListInput,
    context: GovernanceActorContext,
  ): Promise<ConflictEdgeRow[]> {
    const filters: SQL[] = [
      sql`e.tenant_id = ${context.tenantId}`,
      sql`coalesce(e.effective_confidence_score, 0) > 0`,
      sql`e.confidence_label <> 'REJECTED'`,
    ];
    const spaceId = normalizeOptionalString(input.space_id);
    if (spaceId !== undefined) {
      filters.push(sql`e.space_id = ${spaceId}`);
    }

    const result = await this.db.execute<ConflictEdgeRow>(sql`
      select
        e.id as edge_id,
        e.space_id,
        e.source_node_id,
        e.target_node_id,
        source_node.label as source_label,
        target_node.label as target_label,
        e.relation_type,
        e.confidence_label,
        e.effective_confidence_score
      from graph_edges e
      inner join graph_nodes source_node
        on source_node.id = e.source_node_id
       and source_node.tenant_id = e.tenant_id
      inner join graph_nodes target_node
        on target_node.id = e.target_node_id
       and target_node.tenant_id = e.tenant_id
      where ${sql.join(filters, sql` and `)}
      limit 1000
    `);

    return rowsFromResult<ConflictEdgeRow>(result);
  }

  private async fetchEdgeChunkMismatchRows(
    input: ConflictListInput,
    context: GovernanceActorContext,
  ): Promise<EdgeChunkMismatchRow[]> {
    const filters: SQL[] = [
      sql`e.tenant_id = ${context.tenantId}`,
      sql`coalesce(e.effective_confidence_score, 0) > 0`,
      sql`e.confidence_label <> 'REJECTED'`,
    ];
    const spaceId = normalizeOptionalString(input.space_id);
    if (spaceId !== undefined) {
      filters.push(sql`e.space_id = ${spaceId}`);
    }

    const result = await this.db.execute<EdgeChunkMismatchRow>(sql`
      select
        e.id as edge_id,
        e.space_id,
        e.source_node_id,
        e.target_node_id,
        source_node.label as source_label,
        target_node.label as target_label,
        e.relation_type,
        e.confidence_label,
        e.effective_confidence_score,
        chunk.id as chunk_id,
        chunk.content as chunk_content
      from graph_edges e
      inner join graph_nodes source_node
        on source_node.id = e.source_node_id
       and source_node.tenant_id = e.tenant_id
      inner join graph_nodes target_node
        on target_node.id = e.target_node_id
       and target_node.tenant_id = e.tenant_id
      inner join wiki_chunks chunk
        on chunk.tenant_id = e.tenant_id
       and chunk.space_id = e.space_id
       and chunk.content ilike '%' || source_node.label || '%'
       and chunk.content ilike '%' || target_node.label || '%'
      where ${sql.join(filters, sql` and `)}
      limit 1000
    `);

    return rowsFromResult<EdgeChunkMismatchRow>(result);
  }

  private async createGovernanceReindexJob(
    spaceId: string,
    context: GovernanceActorContext,
    metadata: JsonRecord,
  ): Promise<JobRow> {
    const job = await JobRepository.create(this.db, {
      tenant_id: context.tenantId,
      space_id: spaceId,
      queue_name: QUEUE_INDEXING,
      type: 'reindex',
      payload_json: {
        tenant_id: context.tenantId,
        space_id: spaceId,
        trigger: 'governance_action',
        scope: 'full',
        ...metadata,
      },
      created_by: context.actorUserId,
    });

    await this.enqueueIndexingJob(job.id);
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

function parseEdgeReviewInput(input: unknown): {
  action: 'confirm' | 'reject';
  effective_score: number | undefined;
  reason: string;
} {
  const parsed = governanceEdgeReviewDto.safeParse(input);
  if (parsed.success) {
    return {
      action: parsed.data.action,
      effective_score: parsed.data.effective_score,
      reason: parsed.data.reason,
    };
  }

  if (hasIssueAtPath(parsed.error, 'effective_score')) {
    throwApiError(
      ErrorCode.INVALID_CONFIDENCE_SCORE,
      'Confirming an edge requires effective_score >= 0.55',
      HttpStatus.BAD_REQUEST,
    );
  }

  throwValidationError(parsed.error);
}

function parseMergeInput(input: unknown): {
  from_page_id: string;
  to_page_id: string;
  reason: string;
} {
  const parsed = governanceMergeDto.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  if (hasIssueAtPath(parsed.error, 'to_page_id')) {
    throwApiError(ErrorCode.CANNOT_MERGE_SELF, 'Cannot merge a page into itself', HttpStatus.BAD_REQUEST);
  }

  throwValidationError(parsed.error);
}

function hasIssueAtPath(error: ZodError, path: string): boolean {
  return error.issues.some((issue) => issue.path.join('.') === path);
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

function buildConfirmedEdgeValues(score: number | undefined): {
  effective_confidence_score: number;
  confidence_label: 'EXTRACTED' | 'INFERRED';
} {
  const effectiveScore = requireEffectiveScore(score);
  return {
    effective_confidence_score: effectiveScore,
    confidence_label: confidenceLabelForScore(effectiveScore),
  };
}

function requireEffectiveScore(score: number | undefined): number {
  if (score === undefined) {
    throwApiError(
      ErrorCode.INVALID_CONFIDENCE_SCORE,
      'Confirming an edge requires effective_score >= 0.55',
      HttpStatus.BAD_REQUEST,
    );
  }

  return score;
}

function confidenceLabelForScore(score: number): 'EXTRACTED' | 'INFERRED' {
  return score >= 0.85 ? 'EXTRACTED' : 'INFERRED';
}

function normalizeThreshold(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  }

  return Math.min(1, Math.max(0, value));
}

function normalizePagination(input: { limit?: number; offset?: number; page?: number }): {
  limit: number;
  offset: number;
} {
  const limit = input.limit === undefined || !Number.isFinite(input.limit)
    ? DEFAULT_LIMIT
    : Math.min(MAX_LIMIT, Math.max(1, Math.trunc(input.limit)));
  if (input.offset !== undefined && Number.isFinite(input.offset)) {
    return {
      limit,
      offset: Math.max(0, Math.trunc(input.offset)),
    };
  }

  const page = input.page === undefined || !Number.isFinite(input.page) ? 1 : Math.max(1, Math.trunc(input.page));
  return {
    limit,
    offset: (page - 1) * limit,
  };
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function toLowConfidenceEdgeItem(row: RawLowConfidenceEdgeRow): LowConfidenceEdgeItem {
  return {
    edge_id: row.edge_id,
    source_node: {
      id: row.source_node_id,
      label: row.source_node_label,
    },
    target_node: {
      id: row.target_node_id,
      label: row.target_node_label,
    },
    relation_type: row.relation_type,
    effective_confidence_score: normalizeNullableNumber(row.effective_confidence_score),
    raw_confidence_score: normalizeNullableNumber(row.raw_confidence_score),
    confidence_label: row.confidence_label,
    evidence_count: normalizeNumber(row.evidence_count),
    space_id: row.space_id,
  };
}

function toDuplicateSuggestionItem(row: RawDuplicateSuggestionRow): DuplicateSuggestionItem {
  return {
    page_a_id: row.page_a_id,
    page_b_id: row.page_b_id,
    page_a_title: row.page_a_title,
    page_b_title: row.page_b_title,
    similarity_score: normalizeNumber(row.similarity_score),
    suggested_target: row.suggested_target,
  };
}

function toConflictFeedbackInput(conflict: DetectedConflict): ConflictFeedbackInput {
  return {
    conflict_type: conflict.conflict_type,
    entity_pair: conflict.entity_pair,
    conflicting_items: conflict.conflicting_items,
    severity: conflict.severity,
    fingerprint: conflict.fingerprint,
  };
}

function toConflictListItem(row: ConflictFeedbackRow): ConflictListItem {
  const payload = isRecord(row.payload_json) ? row.payload_json : {};
  return {
    conflict_id: row.id,
    conflict_type: typeof payload.conflict_type === 'string' ? payload.conflict_type : 'unknown',
    entity_pair: payload.entity_pair ?? null,
    conflicting_items: Array.isArray(payload.conflicting_items) ? payload.conflicting_items : [],
    severity: typeof payload.severity === 'string' ? payload.severity : 'medium',
  };
}

function readFingerprint(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const fingerprint = payload.fingerprint;
  return typeof fingerprint === 'string' && fingerprint.trim().length > 0 ? fingerprint : undefined;
}

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }

  if (isRecord(result) && Array.isArray(result.rows)) {
    return result.rows as T[];
  }

  return [];
}

function normalizeNullableNumber(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  return normalizeNumber(value);
}

function normalizeNumber(value: number | string): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toAuditFields(audit: GovernanceAuditContext | undefined): Pick<
  Parameters<AuditService['push']>[0],
  'ip' | 'user_agent' | 'request_id'
> {
  return {
    ...(audit?.ip !== undefined ? { ip: audit.ip } : {}),
    ...(audit?.userAgent !== undefined ? { user_agent: audit.userAgent } : {}),
    ...(audit?.requestId !== undefined ? { request_id: audit.requestId } : {}),
  };
}

function throwApiError(code: ErrorCode, message: string, status: HttpStatus): never {
  throw new HttpException({ code, message }, status);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
