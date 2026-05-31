import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JobRepository, JobStatus, jobs, type JobRow } from '@cherrygraph/job-core';
import {
  ErrorCode,
  graphCommunities,
  graphEdges,
  graphNodes,
  graphReports,
  graphifyRuns,
  group_members,
  source_documents,
  space_permissions,
  spaces,
  wikiPages,
  type GraphifyRunMode,
  type GraphifyRunStatus,
  type GraphifyTriggerType,
} from '@cherrygraph/shared';
import { ROLES, normalizeRole } from '@cherrygraph/auth-core';
import { and, asc, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';

import {
  buildPaginationMeta,
  paginatedResponse,
  parseSortField,
  type PaginatedResponse,
} from '../common/dto/pagination.dto.js';
import { getApiLogger } from '../common/logger/logger.module.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { throwApiError } from '../common/errors/api-error.js';

export type GraphifyDatabase = NodePgDatabase;
export type GraphifyRunRow = typeof graphifyRuns.$inferSelect;
type GraphReportRow = typeof graphReports.$inferSelect;
type SpaceRow = typeof spaces.$inferSelect;

export type GraphifyAuditContext = {
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

export type GraphifyContext = {
  tenantId?: string;
  actorUserId?: string;
  actorRole?: string;
  userId?: string;
  actorPermissions?: string[];
  audit?: GraphifyAuditContext;
};

export type GraphifyInputScope = {
  page_ids?: string[];
  source_document_ids?: string[];
};

export type GraphifyOptions = {
  wiki?: boolean;
  no_viz?: boolean;
  directed?: boolean;
};

export type CreateGraphifyRunInput = {
  mode: GraphifyRunMode;
  trigger_type: GraphifyTriggerType;
  input_scope?: GraphifyInputScope;
  options?: GraphifyOptions;
};

export type GraphifyRunsQuery = {
  page?: number;
  per_page?: number;
  sort?: string;
  space_id?: string;
  status?: GraphifyRunStatus;
  trigger_type?: GraphifyTriggerType;
};

export type GraphifyRunResponse = {
  run_id: string;
  space_id: string;
  space_name?: string;
  mode: string;
  trigger_type: string;
  status: string;
  progress: {
    percent: number;
    stage: string;
  };
  input_scope: {
    page_ids: string[];
    source_document_ids: string[];
  };
  input_scope_resolved: {
    source_documents: Array<{ id: string; filename: string | null; missing: boolean }>;
    pages: Array<{ id: string; title: string | null; missing: boolean }>;
  };
  result: {
    nodes_created: number;
    nodes_updated: number;
    edges_created: number;
    wiki_pages_generated: number;
    schema_version: string;
    graph_json_uri: string | null;
    report_uri: string | null;
  };
  stats_json: unknown;
  error_json: unknown;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
};

export type CancelGraphifyRunResponse = {
  run_id: string;
  status: 'cancelling';
};

export type GraphifyReportResponse = {
  run_id: string;
  report_format: 'markdown';
  content: string;
  generated_at: Date;
};

export type GraphifyGraphSummaryResponse = {
  run_id: string;
  summary: {
    node_count: number;
    edge_count: number;
    community_count: number;
  };
  top_entities: unknown[];
  schema_version: string;
};

export type GraphifyCompletionPayload = {
  graph_json_uri?: string | null;
  wiki_output_uri?: string | null;
  report_uri?: string | null;
  graph_html_uri?: string | null;
  schema_version?: string;
  stats_json?: Record<string, unknown>;
};

type GraphifySortField = 'created_at' | 'started_at' | 'completed_at' | 'status' | 'mode' | 'trigger_type';
type GraphifyPermission = 'graphify:view' | 'graphify:run';
export type GraphifyRunRowWithSpaceName = GraphifyRunRow & { space_name?: string | null };

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;
const GRAPHIFY_QUEUE_NAME = 'graphify';
const GRAPHIFY_JOB_TYPE = 'graphify';
const DEFAULT_GRAPHIFY_TIMEOUT_SECONDS = 3600;
const GRAPHIFY_SORT_FIELDS = new Set<GraphifySortField>([
  'created_at',
  'started_at',
  'completed_at',
  'status',
  'mode',
  'trigger_type',
]);

@Injectable()
export class GraphifyService {
  constructor(
    @Inject(DRIZZLE) private readonly db: GraphifyDatabase,
    private readonly auditService: AuditService,
  ) {}

  async createRun(
    spaceId: string,
    input: CreateGraphifyRunInput,
    context: GraphifyContext = {},
  ): Promise<GraphifyRunResponse> {
    const tenantId = resolveTenantId(context);
    const actorUserId = resolveContextUserId(context);
    await this.assertSpacePermission(tenantId, spaceId, context, 'graphify:run');
    await this.assertNoConcurrentRun(tenantId, spaceId);

    const created = await this.createRunRecord(tenantId, spaceId, input, actorUserId);

    this.audit('graphify.run.create', tenantId, actorUserId, spaceId, created.id, context, {
      mode: input.mode,
      trigger_type: input.trigger_type,
    });

    const resolved = await resolveInputScope(this.db, [created], tenantId);
    return toGraphifyRunResponse(created, resolved);
  }

  async listRuns(
    query: GraphifyRunsQuery = {},
    context: GraphifyContext = {},
  ): Promise<PaginatedResponse<GraphifyRunResponse>> {
    const tenantId = resolveTenantId(context);
    const page = normalizePositiveInt(query.page, DEFAULT_PAGE);
    const perPage = normalizePositiveInt(query.per_page, DEFAULT_PER_PAGE, MAX_PER_PAGE);
    const accessibleSpaceIds = await this.resolveListSpaceScope(tenantId, query.space_id, context);

    if (accessibleSpaceIds !== undefined && accessibleSpaceIds.length === 0) {
      return paginatedResponse([], buildPaginationMeta(page, perPage, 0));
    }

    const where = buildRunsWhere(tenantId, query, accessibleSpaceIds);
    const order = buildRunOrder(query.sort ?? '-created_at');

    const rowsWithSpaceName = await this.db
      .select({ run: graphifyRuns, space_name: spaces.name })
      .from(graphifyRuns)
      .leftJoin(spaces, and(eq(spaces.id, graphifyRuns.space_id), eq(spaces.tenant_id, tenantId)))
      .where(where)
      .orderBy(order)
      .limit(perPage)
      .offset((page - 1) * perPage);
    const [countRow] = await this.db.select({ total: count() }).from(graphifyRuns).where(where);

    const rows: GraphifyRunRowWithSpaceName[] = rowsWithSpaceName.map((row) => ({
      ...row.run,
      space_name: row.space_name,
    }));
    const resolved = await resolveInputScope(this.db, rows, tenantId);

    return paginatedResponse(
      rows.map((row) => toGraphifyRunResponse(row, resolved)),
      buildPaginationMeta(page, perPage, normalizeCount(countRow?.total)),
    );
  }

  async getRun(runId: string, context: GraphifyContext = {}): Promise<GraphifyRunResponse> {
    const run = await this.getAccessibleRun(runId, context, 'graphify:view');
    const resolved = await resolveInputScope(this.db, [run], run.tenant_id);
    return toGraphifyRunResponse(run, resolved);
  }

  async cancelRun(
    runId: string,
    context: GraphifyContext = {},
  ): Promise<CancelGraphifyRunResponse> {
    const run = await this.getAccessibleRun(runId, context, 'graphify:run');
    if (run.status !== 'pending' && run.status !== 'running') {
      throwApiError(
        ErrorCode.GRAPHIFY_RUN_NOT_CANCELLABLE,
        'Graphify run is not cancellable',
        HttpStatus.CONFLICT,
      );
    }

    const tenantId = resolveTenantId(context);
    const actorUserId = resolveContextUserId(context);
    const cancelledAt = new Date();
    await this.withTransaction(async (tx) => {
      const [updated] = await tx
        .update(graphifyRuns)
        .set({
          status: 'cancelled',
          completed_at: cancelledAt,
        })
        .where(and(eq(graphifyRuns.tenant_id, tenantId), eq(graphifyRuns.id, run.id)))
        .returning();

      if (updated === undefined) {
        throw new Error(`Failed to cancel graphify run ${run.id}`);
      }

      if (run.job_id !== null) {
        await this.cancelRunJob(tx, tenantId, run.job_id, cancelledAt);
      }
    });

    this.audit('graphify.run.cancel', tenantId, actorUserId, run.space_id, run.id, context, {});

    return {
      run_id: run.id,
      status: 'cancelling',
    };
  }

  async retryRun(runId: string, context: GraphifyContext = {}): Promise<GraphifyRunResponse> {
    const run = await this.getAccessibleRun(runId, context, 'graphify:run');
    const terminalStates = new Set(['failed', 'cancelled', 'succeeded']);
    if (!terminalStates.has(run.status)) {
      throwApiError(
        ErrorCode.GRAPHIFY_RUN_NOT_RETRYABLE,
        'Graphify run is not retryable',
        HttpStatus.CONFLICT,
      );
    }

    const tenantId = resolveTenantId(context);
    const actorUserId = resolveContextUserId(context);
    await this.assertNoConcurrentRun(tenantId, run.space_id);

    const originalJob = run.job_id === null ? undefined : await this.findJob(tenantId, run.job_id);
    const originalPayload = asRecord(originalJob?.payload_json);
    const originalInputScope = readInputScope(originalPayload.input_scope);
    const originalOptions = readGraphifyOptions(originalPayload.options);
    const retryInput: CreateGraphifyRunInput = {
      mode: normalizeRunMode(run.mode),
      trigger_type: normalizeTriggerType(run.trigger_type),
      ...(originalInputScope !== undefined ? { input_scope: originalInputScope } : {}),
      ...(originalOptions !== undefined ? { options: originalOptions } : {}),
    };
    const created = await this.createRunRecord(tenantId, run.space_id, retryInput, actorUserId);

    this.audit('graphify.run.retry', tenantId, actorUserId, run.space_id, created.id, context, {
      original_run_id: run.id,
    });

    const resolved = await resolveInputScope(this.db, [created], tenantId);
    return toGraphifyRunResponse(created, resolved);
  }

  async getReport(runId: string, context: GraphifyContext = {}): Promise<GraphifyReportResponse> {
    const run = await this.getAccessibleRun(runId, context, 'graphify:view');
    const [report] = await this.db
      .select()
      .from(graphReports)
      .where(
        and(
          eq(graphReports.tenant_id, run.tenant_id),
          eq(graphReports.space_id, run.space_id),
          eq(graphReports.graphify_run_id, run.id),
        ),
      )
      .limit(1);

    if (report === undefined) {
      throwApiError(ErrorCode.NOT_FOUND, 'Graphify report was not found', HttpStatus.NOT_FOUND);
    }

    return toGraphifyReportResponse(run.id, report);
  }

  async getGraphSummary(
    runId: string,
    context: GraphifyContext = {},
  ): Promise<GraphifyGraphSummaryResponse> {
    const run = await this.getAccessibleRun(runId, context, 'graphify:view');

    const [nodeCountRow] = await this.db
      .select({ total: count() })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.tenant_id, run.tenant_id),
          eq(graphNodes.space_id, run.space_id),
          eq(graphNodes.graphify_run_id, run.id),
        ),
      );
    const [edgeCountRow] = await this.db
      .select({ total: count() })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.tenant_id, run.tenant_id),
          eq(graphEdges.space_id, run.space_id),
          eq(graphEdges.graphify_run_id, run.id),
        ),
      );
    const [communityCountRow] = await this.db
      .select({ total: count() })
      .from(graphCommunities)
      .where(
        and(
          eq(graphCommunities.tenant_id, run.tenant_id),
          eq(graphCommunities.space_id, run.space_id),
          eq(graphCommunities.graphify_run_id, run.id),
        ),
      );

    return {
      run_id: run.id,
      summary: {
        node_count: normalizeCount(nodeCountRow?.total),
        edge_count: normalizeCount(edgeCountRow?.total),
        community_count: normalizeCount(communityCountRow?.total),
      },
      top_entities: [],
      schema_version: run.schema_version,
    };
  }

  async handleRunCompletion(
    runId: string,
    resultPayload: GraphifyCompletionPayload,
  ): Promise<GraphifyRunResponse> {
    const run = await this.findRunById(undefined, runId);
    if (run === undefined) {
      throwGraphifyRunNotFound();
    }

    const completedAt = new Date();
    const stats = {
      ...asRecord(run.stats_json),
      ...asRecord(resultPayload.stats_json),
    };
    const [updated] = await this.db
      .update(graphifyRuns)
      .set({
        status: 'succeeded',
        graph_json_uri: resultPayload.graph_json_uri ?? run.graph_json_uri,
        wiki_output_uri: resultPayload.wiki_output_uri ?? run.wiki_output_uri,
        report_uri: resultPayload.report_uri ?? run.report_uri,
        graph_html_uri: resultPayload.graph_html_uri ?? run.graph_html_uri,
        schema_version: resultPayload.schema_version ?? run.schema_version,
        stats_json: stats,
        error_json: null,
        completed_at: completedAt,
      })
      .where(and(eq(graphifyRuns.id, run.id), inArray(graphifyRuns.status, ['pending', 'running'])))
      .returning();

    if (updated === undefined) {
      getApiLogger().warn(
        { run_id: run.id, selected_status: run.status },
        'Graphify run completion skipped — run not in active state',
      );
      return toGraphifyRunResponse(run);
    }

    return toGraphifyRunResponse(updated);
  }

  async handleRunFailure(runId: string, error: { error_json: Record<string, unknown> }): Promise<void> {
    await this.db
      .update(graphifyRuns)
      .set({
        status: 'failed',
        error_json: error.error_json,
        completed_at: new Date(),
      })
      .where(and(eq(graphifyRuns.id, runId), inArray(graphifyRuns.status, ['pending', 'running'])));
  }

  private async createRunRecord(
    tenantId: string,
    spaceId: string,
    input: CreateGraphifyRunInput,
    actorUserId: string,
  ): Promise<GraphifyRunRow> {
    const runId = randomUUID();
    const now = new Date();
    const inputScope = normalizeInputScope(input.input_scope);
    const options = normalizeOptions(input.options);
    const inputUris = await this.loadInputUris(tenantId, spaceId, inputScope);

    return this.withTransaction(async (tx) => {
      const [createdRun] = await tx
        .insert(graphifyRuns)
        .values({
          id: runId,
          tenant_id: tenantId,
          space_id: spaceId,
          trigger_type: input.trigger_type,
          mode: input.mode,
          status: 'pending',
          schema_version: 'v1',
          stats_json: {
            input_scope: inputScope ?? {},
            options: options ?? {},
            input_uri_count: inputUris.length,
          },
          created_by: actorUserId,
          created_at: now,
        })
        .returning();

      if (createdRun === undefined) {
        throw new Error('Failed to create graphify run');
      }

      const job = await JobRepository.create(tx, {
        tenant_id: tenantId,
        space_id: spaceId,
        queue_name: GRAPHIFY_QUEUE_NAME,
        type: GRAPHIFY_JOB_TYPE,
        priority: 100,
        timeout_seconds: parseGraphifyTimeoutSeconds(),
        payload_json: {
          tenant_id: tenantId,
          space_id: spaceId,
          run_id: runId,
          mode: input.mode,
          trigger_type: input.trigger_type,
          ...(inputScope !== undefined ? { input_scope: inputScope } : {}),
          ...(options !== undefined ? { options } : {}),
          input_uris: inputUris,
        },
        created_by: actorUserId,
      });

      const [updatedRun] = await tx
        .update(graphifyRuns)
        .set({ job_id: job.id })
        .where(eq(graphifyRuns.id, runId))
        .returning();

      if (updatedRun === undefined) {
        throw new Error(`Failed to link graphify run ${runId} to job ${job.id}`);
      }

      return updatedRun;
    });
  }

  private async assertNoConcurrentRun(tenantId: string, spaceId: string): Promise<void> {
    const [existing] = await this.db
      .select({ id: graphifyRuns.id })
      .from(graphifyRuns)
      .where(
        and(
          eq(graphifyRuns.tenant_id, tenantId),
          eq(graphifyRuns.space_id, spaceId),
          inArray(graphifyRuns.status, ['pending', 'running']),
        ),
      )
      .limit(1);

    if (existing !== undefined) {
      throwApiError(
        ErrorCode.GRAPHIFY_RUN_IN_PROGRESS,
        'A Graphify run is already in progress for this space',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async getAccessibleRun(
    runId: string,
    context: GraphifyContext,
    permission: GraphifyPermission,
  ): Promise<GraphifyRunRow> {
    const tenantId = resolveTenantId(context);
    const run = await this.findRunById(tenantId, runId);
    if (run === undefined) {
      throwGraphifyRunNotFound();
    }

    await this.assertSpacePermission(tenantId, run.space_id, context, permission);
    return run;
  }

  private async findRunById(
    tenantId: string | undefined,
    runId: string,
  ): Promise<GraphifyRunRow | undefined> {
    const filters = [eq(graphifyRuns.id, runId)];
    if (tenantId !== undefined) {
      filters.unshift(eq(graphifyRuns.tenant_id, tenantId));
    }

    const [run] = await this.db
      .select()
      .from(graphifyRuns)
      .where(and(...filters))
      .limit(1);

    return run;
  }

  private async assertSpacePermission(
    tenantId: string,
    spaceId: string,
    context: GraphifyContext,
    permission: GraphifyPermission,
  ): Promise<SpaceRow> {
    const [space] = await this.db
      .select()
      .from(spaces)
      .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.id, spaceId)))
      .limit(1);

    if (space === undefined) {
      throwApiError(ErrorCode.SPACE_NOT_FOUND, 'Space not found', HttpStatus.NOT_FOUND);
    }

    if (hasImplicitSpaceAccess(context.actorRole)) {
      return space;
    }

    const userId = resolveContextUserId(context);
    const allowed = await this.hasSpacePermission(tenantId, userId, spaceId, permission);
    if (!allowed) {
      throwApiError(ErrorCode.PERMISSION_DENIED, 'Permission denied', HttpStatus.FORBIDDEN);
    }

    return space;
  }

  private async resolveListSpaceScope(
    tenantId: string,
    spaceId: string | undefined,
    context: GraphifyContext,
  ): Promise<string[] | undefined> {
    if (spaceId !== undefined && spaceId.trim().length > 0) {
      await this.assertSpacePermission(tenantId, spaceId.trim(), context, 'graphify:view');
      return [spaceId.trim()];
    }

    if (hasImplicitSpaceAccess(context.actorRole)) {
      return undefined;
    }

    const userId = resolveContextUserId(context);
    return this.getAccessibleSpaceIds(tenantId, userId, 'graphify:view');
  }

  private async getAccessibleSpaceIds(
    tenantId: string,
    userId: string,
    permission: GraphifyPermission,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ space_id: space_permissions.space_id })
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
          inArray(space_permissions.permission, satisfyingPermissions(permission)),
        ),
      );

    return [...new Set(rows.map((row) => row.space_id))];
  }

  private async hasSpacePermission(
    tenantId: string,
    userId: string,
    spaceId: string,
    permission: GraphifyPermission,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ space_id: space_permissions.space_id })
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
          inArray(space_permissions.permission, satisfyingPermissions(permission)),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  private async loadInputUris(
    tenantId: string,
    spaceId: string,
    inputScope: GraphifyInputScope | undefined,
  ): Promise<string[]> {
    if (inputScope !== undefined && inputScope.source_document_ids === undefined) {
      return [];
    }

    const filters: SQL[] = [
      eq(source_documents.tenant_id, tenantId),
      eq(source_documents.space_id, spaceId),
      inArray(source_documents.status, ['parsed', 'graphify_pending']),
    ];

    if (inputScope?.source_document_ids !== undefined) {
      const sourceDocumentIds = inputScope.source_document_ids;
      if (sourceDocumentIds.length === 0) {
        return [];
      }

      filters.push(inArray(source_documents.id, sourceDocumentIds));
    }

    const rows = await this.db
      .select({ parsed_uri: source_documents.parsed_uri })
      .from(source_documents)
      .where(and(...filters))
      .orderBy(asc(source_documents.created_at))
      .limit(1000);

    return rows.flatMap((row) => (typeof row.parsed_uri === 'string' && row.parsed_uri.length > 0 ? [row.parsed_uri] : []));
  }

  private async cancelRunJob(
    db: GraphifyDatabase,
    tenantId: string,
    jobId: string,
    cancelledAt: Date,
  ): Promise<void> {
    const job = await this.findJob(tenantId, jobId, db);
    if (job === undefined) {
      return;
    }

    if (job.status === (JobStatus.PENDING as string)) {
      await db
        .update(jobs)
        .set({
          status: JobStatus.CANCELLED,
          cancel_requested_at: cancelledAt,
          completed_at: cancelledAt,
        })
        .where(eq(jobs.id, jobId))
        .returning();
      return;
    }

    await db
      .update(jobs)
      .set({
        cancel_requested_at: cancelledAt,
      })
      .where(eq(jobs.id, jobId))
      .returning();
  }

  private async findJob(
    tenantId: string,
    jobId: string,
    db: GraphifyDatabase = this.db,
  ): Promise<JobRow | undefined> {
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenant_id, tenantId), eq(jobs.id, jobId)))
      .limit(1);

    return job;
  }

  private async withTransaction<T>(callback: (tx: GraphifyDatabase) => Promise<T>): Promise<T> {
    const db = this.db as GraphifyDatabase & {
      transaction?: <TResult>(callback: (tx: GraphifyDatabase) => Promise<TResult>) => Promise<TResult>;
    };

    if (typeof db.transaction === 'function') {
      return db.transaction(callback);
    }

    return callback(this.db);
  }

  private audit(
    action: string,
    tenantId: string,
    actorUserId: string,
    spaceId: string,
    runId: string,
    context: GraphifyContext,
    metadata: Record<string, unknown>,
  ): void {
    this.auditService.push({
      tenant_id: tenantId,
      actor_user_id: actorUserId,
      action,
      resource_type: 'graphify_run',
      resource_id: runId,
      space_id: spaceId,
      ...(context.audit?.ip !== undefined ? { ip: context.audit.ip } : {}),
      ...(context.audit?.userAgent !== undefined ? { user_agent: context.audit.userAgent } : {}),
      ...(context.audit?.requestId !== undefined ? { request_id: context.audit.requestId } : {}),
      metadata_json: metadata,
    });
  }
}

function buildRunsWhere(
  tenantId: string,
  query: GraphifyRunsQuery,
  accessibleSpaceIds: string[] | undefined,
): SQL {
  const filters: SQL[] = [eq(graphifyRuns.tenant_id, tenantId)];

  if (accessibleSpaceIds !== undefined) {
    filters.push(inArray(graphifyRuns.space_id, accessibleSpaceIds));
  }
  if (query.space_id !== undefined && query.space_id.trim().length > 0) {
    filters.push(eq(graphifyRuns.space_id, query.space_id.trim()));
  }
  if (query.status !== undefined) {
    filters.push(eq(graphifyRuns.status, query.status));
  }
  if (query.trigger_type !== undefined) {
    filters.push(eq(graphifyRuns.trigger_type, query.trigger_type));
  }

  return and(...filters) as SQL;
}

function buildRunOrder(sort: string): SQL {
  let parsed: ReturnType<typeof parseSortField>;
  try {
    parsed = parseSortField(sort);
  } catch {
    parsed = { field: 'created_at', direction: 'desc' };
  }

  if (!GRAPHIFY_SORT_FIELDS.has(parsed.field as GraphifySortField)) {
    return desc(graphifyRuns.created_at);
  }

  const columns = {
    created_at: graphifyRuns.created_at,
    started_at: graphifyRuns.started_at,
    completed_at: graphifyRuns.completed_at,
    status: graphifyRuns.status,
    mode: graphifyRuns.mode,
    trigger_type: graphifyRuns.trigger_type,
  } as const satisfies Record<GraphifySortField, unknown>;
  const column = columns[parsed.field as GraphifySortField];
  return parsed.direction === 'desc' ? desc(column) : asc(column);
}

const RESOLVE_CHUNK_SIZE = 200;

export async function resolveInputScope(
  db: GraphifyDatabase,
  runs: GraphifyRunRow[],
  tenantId: string,
): Promise<{ docMap: Map<string, string>; pageMap: Map<string, string> }> {
  const docMap = new Map<string, string>();
  const pageMap = new Map<string, string>();

  if (runs.length === 0) {
    return { docMap, pageMap };
  }

  const spaceGroups = new Map<string, { docIds: Set<string>; pageIds: Set<string> }>();

  for (const run of runs) {
    const stats = asRecord(run.stats_json);
    const inputScope = readInputScope(stats.input_scope);
    let group = spaceGroups.get(run.space_id);
    if (group === undefined) {
      group = { docIds: new Set(), pageIds: new Set() };
      spaceGroups.set(run.space_id, group);
    }
    for (const id of inputScope?.source_document_ids ?? []) {
      group.docIds.add(id);
    }
    for (const id of inputScope?.page_ids ?? []) {
      group.pageIds.add(id);
    }
  }

  for (const [spaceId, group] of spaceGroups) {
    const docIdList = [...group.docIds];
    for (let i = 0; i < docIdList.length; i += RESOLVE_CHUNK_SIZE) {
      const chunk = docIdList.slice(i, i + RESOLVE_CHUNK_SIZE);
      const rows = await db
        .select({ id: source_documents.id, filename: source_documents.filename })
        .from(source_documents)
        .where(
          and(
            eq(source_documents.tenant_id, tenantId),
            eq(source_documents.space_id, spaceId),
            inArray(source_documents.id, chunk),
          ),
        );
      for (const row of rows) {
        docMap.set(row.id, row.filename);
      }
    }

    const pageIdList = [...group.pageIds];
    for (let i = 0; i < pageIdList.length; i += RESOLVE_CHUNK_SIZE) {
      const chunk = pageIdList.slice(i, i + RESOLVE_CHUNK_SIZE);
      const rows = await db
        .select({ id: wikiPages.id, title: wikiPages.title })
        .from(wikiPages)
        .where(
          and(
            eq(wikiPages.tenant_id, tenantId),
            eq(wikiPages.space_id, spaceId),
            inArray(wikiPages.id, chunk),
          ),
        );
      for (const row of rows) {
        pageMap.set(row.id, row.title);
      }
    }
  }

  return { docMap, pageMap };
}

export function toGraphifyRunResponse(
  run: GraphifyRunRowWithSpaceName,
  resolved: { docMap: Map<string, string>; pageMap: Map<string, string> } = {
    docMap: new Map(),
    pageMap: new Map(),
  },
): GraphifyRunResponse {
  const stats = asRecord(run.stats_json);
  const inputScope = readInputScope(stats.input_scope) ?? {};
  const progress = asRecord(stats.progress);

  return {
    run_id: run.id,
    space_id: run.space_id,
    ...(run.space_name !== undefined && run.space_name !== null ? { space_name: run.space_name } : {}),
    mode: run.mode,
    trigger_type: run.trigger_type,
    status: run.status,
    progress: {
      percent: readInteger(progress.percent) ?? defaultProgressPercent(run.status),
      stage: readString(progress.stage) ?? run.status,
    },
    input_scope: {
      page_ids: inputScope.page_ids ?? [],
      source_document_ids: inputScope.source_document_ids ?? [],
    },
    input_scope_resolved: {
      source_documents: (inputScope.source_document_ids ?? []).map((id) => ({
        id,
        filename: resolved.docMap.get(id) ?? null,
        missing: !resolved.docMap.has(id),
      })),
      pages: (inputScope.page_ids ?? []).map((id) => ({
        id,
        title: resolved.pageMap.get(id) ?? null,
        missing: !resolved.pageMap.has(id),
      })),
    },
    result: {
      nodes_created: readInteger(stats.nodes_created) ?? readInteger(stats.node_count) ?? 0,
      nodes_updated: readInteger(stats.nodes_updated) ?? 0,
      edges_created: readInteger(stats.edges_created) ?? readInteger(stats.edge_count) ?? 0,
      wiki_pages_generated: readInteger(stats.wiki_pages_generated) ?? readInteger(stats.wiki_page_count) ?? 0,
      schema_version: run.schema_version,
      graph_json_uri: run.graph_json_uri,
      report_uri: run.report_uri,
    },
    stats_json: run.stats_json,
    error_json: run.error_json,
    created_at: run.created_at,
    started_at: run.started_at,
    completed_at: run.completed_at,
  };
}

function toGraphifyReportResponse(runId: string, report: GraphReportRow): GraphifyReportResponse {
  return {
    run_id: runId,
    report_format: 'markdown',
    content: report.report_markdown,
    generated_at: report.created_at,
  };
}

function defaultProgressPercent(status: string): number {
  if (status === 'pending') {
    return 0;
  }
  if (status === 'running') {
    return 50;
  }

  return 100;
}

function normalizeInputScope(inputScope: GraphifyInputScope | undefined): GraphifyInputScope | undefined {
  if (inputScope === undefined) {
    return undefined;
  }

  const pageIds = normalizeStringArray(inputScope.page_ids);
  const sourceDocumentIds = normalizeStringArray(inputScope.source_document_ids);
  const normalized: GraphifyInputScope = {};

  if (pageIds !== undefined) {
    normalized.page_ids = pageIds;
  }
  if (sourceDocumentIds !== undefined) {
    normalized.source_document_ids = sourceDocumentIds;
  }

  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function normalizeOptions(options: GraphifyOptions | undefined): GraphifyOptions | undefined {
  if (options === undefined) {
    return undefined;
  }

  const normalized: GraphifyOptions = {};
  if (options.wiki !== undefined) {
    normalized.wiki = options.wiki;
  }
  if (options.no_viz !== undefined) {
    normalized.no_viz = options.no_viz;
  }
  if (options.directed !== undefined) {
    normalized.directed = options.directed;
  }

  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function readInputScope(value: unknown): GraphifyInputScope | undefined {
  const record = asRecord(value);
  const pageIds = readStringArray(record.page_ids);
  const sourceDocumentIds = readStringArray(record.source_document_ids);
  const inputScope: GraphifyInputScope = {};

  if (pageIds !== undefined) {
    inputScope.page_ids = pageIds;
  }
  if (sourceDocumentIds !== undefined) {
    inputScope.source_document_ids = sourceDocumentIds;
  }

  return Object.keys(inputScope).length === 0 ? undefined : inputScope;
}

function readGraphifyOptions(value: unknown): GraphifyOptions | undefined {
  const record = asRecord(value);
  const options: GraphifyOptions = {};

  if (typeof record.wiki === 'boolean') {
    options.wiki = record.wiki;
  }
  if (typeof record.no_viz === 'boolean') {
    options.no_viz = record.no_viz;
  }
  if (typeof record.directed === 'boolean') {
    options.directed = record.directed;
  }

  return Object.keys(options).length === 0 ? undefined : options;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return normalizeStringArray(value);
}

function normalizeStringArray(value: unknown[] | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const strings = [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
  return strings.length === 0 ? [] : strings;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function normalizeRunMode(value: string): GraphifyRunMode {
  if (value === 'full' || value === 'update' || value === 'incremental') {
    return value;
  }

  return 'full';
}

function normalizeTriggerType(value: string): GraphifyTriggerType {
  if (value === 'manual' || value === 'scheduled' || value === 'auto') {
    return value;
  }

  return 'manual';
}

function normalizePositiveInt(value: number | undefined, fallback: number, max = Number.POSITIVE_INFINITY): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.min(Math.trunc(value), max);
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function satisfyingPermissions(permission: GraphifyPermission): string[] {
  return [permission, 'space:admin'];
}

function hasImplicitSpaceAccess(role: string | undefined): boolean {
  const normalized = role === undefined ? undefined : normalizeRole(role);
  return normalized === ROLES.OWNER || normalized === ROLES.ADMIN;
}

function resolveTenantId(context: GraphifyContext): string {
  if (context.tenantId !== undefined && context.tenantId.trim().length > 0) {
    return context.tenantId.trim();
  }

  const configuredTenantId = process.env.DEFAULT_TENANT_ID;
  if (configuredTenantId !== undefined && configuredTenantId.trim().length > 0) {
    return configuredTenantId.trim();
  }

  throwApiError(ErrorCode.UNAUTHENTICATED, 'Unauthenticated', HttpStatus.UNAUTHORIZED);
}

function resolveContextUserId(context: GraphifyContext): string {
  const userId = context.userId ?? context.actorUserId;
  if (userId !== undefined && userId.trim().length > 0) {
    return userId.trim();
  }

  throwApiError(ErrorCode.UNAUTHENTICATED, 'Unauthenticated', HttpStatus.UNAUTHORIZED);
}

function parseGraphifyTimeoutSeconds(): number {
  const parsed = Number(process.env.GRAPHIFY_TIMEOUT_SECONDS);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_GRAPHIFY_TIMEOUT_SECONDS;
  }

  return parsed;
}

function throwGraphifyRunNotFound(): never {
  throwApiError(ErrorCode.GRAPHIFY_RUN_NOT_FOUND, 'Graphify run was not found', HttpStatus.NOT_FOUND);
}
