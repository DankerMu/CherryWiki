import { HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import {
  batchCreateSourceLinks as normalizeSourceLinks,
  createSourceLink as normalizeSourceLink,
  getNextVersionNo,
  PublishStateMachine,
  type SourceLink,
} from '@cherrygraph/wiki-core';
import {
  ErrorCode,
  indexSnapshots,
  sourceLinks,
  wikiPageVersions,
  wikiPages,
  wikiSections,
} from '@cherrygraph/shared';
import {
  JobRepository,
  QueueFactory,
  QUEUE_INDEXING,
  jobs,
  type BullMQConnection,
  type JobRow,
} from '@cherrygraph/job-core';
import { and, asc, count, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createHash, randomUUID } from 'node:crypto';

import {
  buildPaginationMeta,
  paginatedResponse,
  parseSortField,
  type PaginatedResponse,
} from '../common/dto/pagination.dto.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { REDIS_CLIENT, type OptionalRedisClient } from '../common/redis/redis.module.js';

type WikiDatabase = NodePgDatabase;
type WikiPageRow = typeof wikiPages.$inferSelect;
type WikiPageVersionRow = typeof wikiPageVersions.$inferSelect;
type SourceLinkRow = typeof sourceLinks.$inferSelect;
type WikiPageSortField = 'created_at' | 'updated_at' | 'title' | 'status';

export type WikiAuditContext = {
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

export type WikiPageResponse = {
  page_id: string;
  space_id: string;
  title: string;
  status: string;
  source: string;
  current_version_id: string | null;
  indexed_version_id: string | null;
  sync_status: string;
  docmost_page_id: string | null;
  tags: string[];
  citations_count: number;
  related_nodes_count: number;
  updated_at: Date;
};

export type WikiPageContent = {
  page_id: string;
  version_id: string;
  title: string;
  content_markdown: string;
  content_hash: string;
  blocks: WikiPageContentBlock[];
};

export type WikiPageContentBlock = {
  block_id: string;
  owner: 'graphify' | 'human';
  editable: boolean;
};

export type WikiPageVersionResponse = {
  version_id: string;
  content_hash: string;
  author: string;
  source_run_id: string | null;
  status: 'current' | 'archived';
  created_at: Date;
};

export type WikiPublishResponse = {
  page_id: string;
  version_id: string;
  status: string;
  published_at: Date;
  published_by: string;
};

export type WikiRollbackResponse = {
  page_id: string;
  rolled_back_to: string;
  new_version_id: string;
  status: string;
  published_at: Date;
  published_by: string;
};

export type WikiReindexResponse = {
  page_id: string;
  reindex_job_id: string;
  status: 'accepted';
};

export type CreateSourceLinkInput = {
  wiki_page_pk: string;
  page_version_id: string;
  section_id?: string | null;
  source_document_id?: string | null;
  source_uri?: string | null;
  quote_hash?: string | null;
  evidence_type?: string;
};

export type SourceLinkResponse = {
  id: string;
  wiki_page_pk: string;
  page_version_id: string;
  section_id: string | null;
  source_document_id: string | null;
  source_uri: string | null;
  quote_hash: string | null;
  evidence_type: string;
  created_at: Date;
};

@Injectable()
export class WikiService {
  private readonly publishStateMachine = new PublishStateMachine();

  constructor(
    @Inject(DRIZZLE) private readonly db: WikiDatabase,
    private readonly auditService: AuditService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: OptionalRedisClient,
  ) {}

  async listPages(
    tenantId: string,
    spaceId: string,
    query: { page?: number; per_page?: number; status?: string; search?: string; sort?: string },
  ): Promise<PaginatedResponse<WikiPageResponse>> {
    const page = normalizePositiveInt(query.page, 1);
    const perPage = normalizePositiveInt(query.per_page, 20, 100);
    const where = buildPageWhere(tenantId, spaceId, query.status, query.search);
    const order = buildPageOrder(query.sort ?? '-updated_at');

    const rows = await this.db
      .select({
        page: wikiPages,
        currentVersion: {
          source: wikiPageVersions.source,
          frontmatter_json: wikiPageVersions.frontmatter_json,
        },
      })
      .from(wikiPages)
      .leftJoin(wikiPageVersions, eq(wikiPages.current_version_id, wikiPageVersions.id))
      .where(where)
      .orderBy(order)
      .limit(perPage)
      .offset((page - 1) * perPage);

    const [countRow] = await this.db.select({ total: count() }).from(wikiPages).where(where);
    const data = rows.map((row) => toPageResponse(row.page, row.currentVersion));

    return paginatedResponse(data, buildPaginationMeta(page, perPage, normalizeCount(countRow?.total)));
  }

  async getPage(tenantId: string, spaceId: string, pageId: string): Promise<WikiPageResponse> {
    const row = await this.findPageWithCurrentVersion(tenantId, spaceId, pageId);
    if (row === undefined) {
      throwApiError(ErrorCode.WIKI_PAGE_NOT_FOUND, 'Wiki page was not found', HttpStatus.NOT_FOUND);
    }

    return toPageResponse(row.page, row.currentVersion);
  }

  async getContent(
    tenantId: string,
    spaceId: string,
    pageId: string,
    versionId?: string,
  ): Promise<WikiPageContent> {
    const page = await this.requirePage(tenantId, spaceId, pageId);
    const resolvedVersionId = versionId ?? page.current_version_id;
    if (resolvedVersionId === null || resolvedVersionId === undefined) {
      throwApiError(ErrorCode.VERSION_NOT_FOUND, 'Wiki page version was not found', HttpStatus.NOT_FOUND);
    }

    const version = await this.findPageVersion(tenantId, spaceId, page.id, resolvedVersionId);
    if (version === undefined) {
      throwApiError(ErrorCode.VERSION_NOT_FOUND, 'Wiki page version was not found', HttpStatus.NOT_FOUND);
    }

    return {
      page_id: page.page_id,
      version_id: version.id,
      title: page.title,
      content_markdown: version.content_markdown,
      content_hash: contentHash(version.content_markdown),
      blocks: readBlocks(version.frontmatter_json),
    };
  }

  async listVersions(
    tenantId: string,
    spaceId: string,
    pageId: string,
    query: { page?: number; per_page?: number },
  ): Promise<PaginatedResponse<WikiPageVersionResponse>> {
    const pageRow = await this.requirePage(tenantId, spaceId, pageId);
    const page = normalizePositiveInt(query.page, 1);
    const perPage = normalizePositiveInt(query.per_page, 20, 100);
    const where = buildVersionWhere(tenantId, spaceId, pageRow.id);

    const rows = await this.db
      .select()
      .from(wikiPageVersions)
      .where(where)
      .orderBy(desc(wikiPageVersions.created_at))
      .limit(perPage)
      .offset((page - 1) * perPage);

    const [countRow] = await this.db.select({ total: count() }).from(wikiPageVersions).where(where);

    return paginatedResponse(
      rows.map((version) => toVersionResponse(version, pageRow.current_version_id)),
      buildPaginationMeta(page, perPage, normalizeCount(countRow?.total)),
    );
  }

  async publish(
    tenantId: string,
    spaceId: string,
    pageId: string,
    versionId: string,
    publishNote: string | undefined,
    actorUserId: string,
    auditContext: WikiAuditContext = {},
  ): Promise<WikiPublishResponse> {
    const page = await this.requirePage(tenantId, spaceId, pageId);
    const version = await this.findPageVersion(tenantId, spaceId, page.id, versionId);
    if (version === undefined) {
      throwApiError(ErrorCode.VERSION_NOT_FOUND, 'Wiki page version was not found', HttpStatus.NOT_FOUND);
    }
    if (version.status === 'published') {
      throwApiError(ErrorCode.VERSION_ALREADY_PUBLISHED, 'Wiki page version is already published', HttpStatus.CONFLICT);
    }

    let nextStatus: string;
    try {
      nextStatus = this.publishStateMachine.publish(version.status);
    } catch (err) {
      if (err instanceof Error && err.message === 'VERSION_ALREADY_PUBLISHED') {
        throwApiError(ErrorCode.VERSION_ALREADY_PUBLISHED, 'Wiki page version is already published', HttpStatus.CONFLICT);
      }

      throwApiError(ErrorCode.ILLEGAL_STATUS_TRANSITION, 'Wiki page version cannot be published', HttpStatus.CONFLICT);
    }

    const publishedAt = new Date();
    await this.withTransaction(async (tx) => {
      await this.updateVersionStatus(tx, version.id, nextStatus);
      await this.updatePageCurrentVersion(tx, page.id, version.id, nextStatus, publishedAt);
    });

    this.auditService.push({
      tenant_id: tenantId,
      actor_user_id: actorUserId,
      action: 'wiki.page.publish',
      resource_type: 'wiki_page',
      resource_id: pageId,
      space_id: spaceId,
      ...(auditContext.ip !== undefined ? { ip: auditContext.ip } : {}),
      ...(auditContext.userAgent !== undefined ? { user_agent: auditContext.userAgent } : {}),
      ...(auditContext.requestId !== undefined ? { request_id: auditContext.requestId } : {}),
      metadata_json: {
        version_id: versionId,
        ...(publishNote !== undefined ? { publish_note: publishNote } : {}),
      },
    });

    return {
      page_id: pageId,
      version_id: versionId,
      status: nextStatus,
      published_at: publishedAt,
      published_by: actorUserId,
    };
  }

  async unpublish(
    tenantId: string,
    spaceId: string,
    pageId: string,
    versionId: string,
    reason: string | undefined,
    actorUserId: string,
    auditContext: WikiAuditContext = {},
  ): Promise<WikiPublishResponse> {
    const page = await this.requirePage(tenantId, spaceId, pageId);
    const version = await this.findPageVersion(tenantId, spaceId, page.id, versionId);
    if (version === undefined) {
      throwApiError(ErrorCode.VERSION_NOT_FOUND, 'Wiki page version was not found', HttpStatus.NOT_FOUND);
    }
    if (version.status === 'draft') {
      throwApiError(ErrorCode.ILLEGAL_STATUS_TRANSITION, 'Wiki page version is already a draft', HttpStatus.CONFLICT);
    }

    let nextStatus: string;
    try {
      nextStatus = this.publishStateMachine.unpublish(version.status);
    } catch (err) {
      if (err instanceof Error && err.message === 'VERSION_ALREADY_DRAFT') {
        throwApiError(ErrorCode.ILLEGAL_STATUS_TRANSITION, 'Wiki page version is already a draft', HttpStatus.CONFLICT);
      }
      throwApiError(ErrorCode.ILLEGAL_STATUS_TRANSITION, 'Wiki page version cannot be unpublished', HttpStatus.CONFLICT);
    }

    const unpublishedAt = new Date();
    await this.withTransaction(async (tx) => {
      await this.updateVersionStatus(tx, version.id, nextStatus);
      await this.updatePageCurrentVersion(tx, page.id, version.id, nextStatus, unpublishedAt);
    });

    this.auditService.push({
      tenant_id: tenantId,
      actor_user_id: actorUserId,
      action: 'wiki.page.unpublish',
      resource_type: 'wiki_page',
      resource_id: pageId,
      space_id: spaceId,
      ...(auditContext.ip !== undefined ? { ip: auditContext.ip } : {}),
      ...(auditContext.userAgent !== undefined ? { user_agent: auditContext.userAgent } : {}),
      ...(auditContext.requestId !== undefined ? { request_id: auditContext.requestId } : {}),
      metadata_json: {
        version_id: versionId,
        ...(reason !== undefined ? { reason } : {}),
      },
    });

    return {
      page_id: pageId,
      version_id: versionId,
      status: nextStatus,
      published_at: unpublishedAt,
      published_by: actorUserId,
    };
  }

  async rollback(
    tenantId: string,
    spaceId: string,
    pageId: string,
    targetVersionId: string,
    reason: string | undefined,
    actorUserId: string,
    auditContext: WikiAuditContext = {},
  ): Promise<WikiRollbackResponse> {
    const page = await this.requirePage(tenantId, spaceId, pageId);
    const targetVersion = await this.findPageVersion(tenantId, spaceId, page.id, targetVersionId);
    if (targetVersion === undefined) {
      throwApiError(ErrorCode.VERSION_NOT_FOUND, 'Wiki page version was not found', HttpStatus.NOT_FOUND);
    }

    const publishedAt = new Date();
    const createdVersion = await this.withTransaction(async (tx) => {
      const versionNos = await tx
        .select({ version_no: wikiPageVersions.version_no })
        .from(wikiPageVersions)
        .where(buildVersionWhere(tenantId, spaceId, page.id));
      const nextVersionNo = getNextVersionNo(versionNos.map((row) => row.version_no));
      const rollback = this.publishStateMachine.rollback(targetVersion.content_markdown, nextVersionNo - 1);
      const [created] = await tx
        .insert(wikiPageVersions)
        .values({
          id: randomUUID(),
          tenant_id: tenantId,
          space_id: spaceId,
          wiki_page_pk: page.id,
          page_id: page.page_id,
          version_no: rollback.versionNo,
          content_markdown: rollback.content,
          frontmatter_json: targetVersion.frontmatter_json,
          source: rollback.source,
          status: rollback.status,
          created_by: actorUserId,
          created_at: publishedAt,
        })
        .returning();

      if (created === undefined) {
        throw new Error('Failed to create rollback wiki page version');
      }

      await this.updatePageCurrentVersion(tx, page.id, created.id, rollback.status, publishedAt);
      return created;
    });

    this.auditService.push({
      tenant_id: tenantId,
      actor_user_id: actorUserId,
      action: 'wiki.page.rollback',
      resource_type: 'wiki_page',
      resource_id: pageId,
      space_id: spaceId,
      ...(auditContext.ip !== undefined ? { ip: auditContext.ip } : {}),
      ...(auditContext.userAgent !== undefined ? { user_agent: auditContext.userAgent } : {}),
      ...(auditContext.requestId !== undefined ? { request_id: auditContext.requestId } : {}),
      metadata_json: {
        target_version_id: targetVersionId,
        new_version_id: createdVersion.id,
        ...(reason !== undefined ? { reason } : {}),
      },
    });

    return {
      page_id: pageId,
      rolled_back_to: targetVersionId,
      new_version_id: createdVersion.id,
      status: createdVersion.status,
      published_at: publishedAt,
      published_by: actorUserId,
    };
  }

  async reindexPage(
    tenantId: string,
    spaceId: string,
    pageId: string,
    actorUserId: string,
    idempotencyKey?: string,
    auditContext: WikiAuditContext = {},
  ): Promise<WikiReindexResponse> {
    const existingJob = await this.findIdempotentJob(tenantId, idempotencyKey);
    if (existingJob !== undefined) {
      return toReindexResponse(pageId, existingJob);
    }

    await this.requirePage(tenantId, spaceId, pageId);
    await this.assertNoBuildingSnapshot(tenantId, spaceId, 'REINDEX_ALREADY_RUNNING', 'A reindex job is already running for this space');

    const job = await JobRepository.create(this.db, {
      tenant_id: tenantId,
      space_id: spaceId,
      queue_name: QUEUE_INDEXING,
      type: 'reindex',
      payload_json: {
        tenant_id: tenantId,
        space_id: spaceId,
        page_id: pageId,
        trigger: 'manual_reindex',
        scope: 'single_page',
      },
      ...(idempotencyKey !== undefined ? { idempotency_key: idempotencyKey } : {}),
      created_by: actorUserId,
    });

    await this.enqueueIndexingJob(job.id);
    this.auditService.push({
      tenant_id: tenantId,
      actor_user_id: actorUserId,
      action: 'wiki.page.reindex',
      resource_type: 'wiki_page',
      resource_id: pageId,
      space_id: spaceId,
      ...(auditContext.ip !== undefined ? { ip: auditContext.ip } : {}),
      ...(auditContext.userAgent !== undefined ? { user_agent: auditContext.userAgent } : {}),
      ...(auditContext.requestId !== undefined ? { request_id: auditContext.requestId } : {}),
      metadata_json: {
        reindex_job_id: job.id,
        trigger: 'manual_reindex',
        scope: 'single_page',
      },
    });

    return toReindexResponse(pageId, job);
  }

  async createSourceLink(
    tenantId: string,
    spaceId: string,
    link: CreateSourceLinkInput,
  ): Promise<SourceLinkResponse> {
    await this.requireSourceLinkVersionScope(this.db, tenantId, spaceId, link.wiki_page_pk, link.page_version_id);

    const [created] = await this.db
      .insert(sourceLinks)
      .values(toSourceLinkInsert(tenantId, spaceId, link))
      .returning();

    if (created === undefined) {
      throw new Error('Failed to create source link');
    }

    return toSourceLinkResponse(created);
  }

  async batchCreateSourceLinks(
    tenantId: string,
    spaceId: string,
    links: CreateSourceLinkInput[],
  ): Promise<SourceLinkResponse[]> {
    if (links.length === 0) {
      return [];
    }

    return this.withTransaction(async (tx) => {
      const normalizedLinks = normalizeSourceLinks(links.map(toCoreSourceLink));
      for (const link of normalizedLinks) {
        await this.requireSourceLinkVersionScope(tx, tenantId, spaceId, link.wiki_page_pk, link.page_version_id);
      }

      const rows = await tx
        .insert(sourceLinks)
        .values(normalizedLinks.map((link) => toSourceLinkInsert(tenantId, spaceId, link)))
        .returning();

      return rows.map((row) => toSourceLinkResponse(row));
    });
  }

  async querySourceLinksByPageVersion(
    tenantId: string,
    spaceId: string,
    pageVersionId: string,
  ): Promise<SourceLinkResponse[]> {
    const rows = await this.db
      .select({
        link: sourceLinks,
        section_id: wikiSections.section_id,
      })
      .from(sourceLinks)
      .leftJoin(wikiSections, eq(sourceLinks.section_id, wikiSections.id))
      .where(
        and(
          eq(sourceLinks.tenant_id, tenantId),
          eq(sourceLinks.space_id, spaceId),
          eq(sourceLinks.page_version_id, pageVersionId),
        ),
      )
      .orderBy(sql`${wikiSections.section_index} ASC NULLS LAST`, asc(sourceLinks.created_at))
      .limit(1000);

    return rows.map((row) => toSourceLinkResponse(row.link, row.section_id));
  }

  private async findPageWithCurrentVersion(
    tenantId: string,
    spaceId: string,
    pageId: string,
  ): Promise<{ page: WikiPageRow; currentVersion: CurrentVersionSelection | null } | undefined> {
    const [row] = await this.db
      .select({
        page: wikiPages,
        currentVersion: {
          source: wikiPageVersions.source,
          frontmatter_json: wikiPageVersions.frontmatter_json,
        },
      })
      .from(wikiPages)
      .leftJoin(wikiPageVersions, eq(wikiPages.current_version_id, wikiPageVersions.id))
      .where(
        and(
          eq(wikiPages.tenant_id, tenantId),
          eq(wikiPages.space_id, spaceId),
          eq(wikiPages.page_id, pageId),
        ),
      )
      .limit(1);

    return row;
  }

  private async requirePage(tenantId: string, spaceId: string, pageId: string): Promise<WikiPageRow> {
    const row = await this.findPageWithCurrentVersion(tenantId, spaceId, pageId);
    if (row === undefined) {
      throwApiError(ErrorCode.WIKI_PAGE_NOT_FOUND, 'Wiki page was not found', HttpStatus.NOT_FOUND);
    }

    return row.page;
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

  private async assertNoBuildingSnapshot(
    tenantId: string,
    spaceId: string,
    code: string,
    message: string,
  ): Promise<void> {
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
      throwApiError(code, message, HttpStatus.CONFLICT);
    }
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

  private async findPageVersion(
    tenantId: string,
    spaceId: string,
    wikiPagePk: string,
    versionId: string,
  ): Promise<WikiPageVersionRow | undefined> {
    const [version] = await this.db
      .select()
      .from(wikiPageVersions)
      .where(
        and(
          eq(wikiPageVersions.tenant_id, tenantId),
          eq(wikiPageVersions.space_id, spaceId),
          eq(wikiPageVersions.wiki_page_pk, wikiPagePk),
          eq(wikiPageVersions.id, versionId),
        ),
      )
      .limit(1);

    return version;
  }

  private async requireSourceLinkVersionScope(
    db: WikiDatabase,
    tenantId: string,
    spaceId: string,
    wikiPagePk: string,
    pageVersionId: string,
  ): Promise<void> {
    const [version] = await db
      .select({ id: wikiPageVersions.id })
      .from(wikiPageVersions)
      .where(
        and(
          eq(wikiPageVersions.tenant_id, tenantId),
          eq(wikiPageVersions.space_id, spaceId),
          eq(wikiPageVersions.wiki_page_pk, wikiPagePk),
          eq(wikiPageVersions.id, pageVersionId),
        ),
      )
      .limit(1);

    if (version === undefined) {
      throwApiError(ErrorCode.VERSION_NOT_FOUND, 'Wiki page version was not found', HttpStatus.NOT_FOUND);
    }
  }

  private async updateVersionStatus(db: WikiDatabase, versionId: string, status: string): Promise<void> {
    const [updated] = await db
      .update(wikiPageVersions)
      .set({ status })
      .where(eq(wikiPageVersions.id, versionId))
      .returning();

    if (updated === undefined) {
      throw new Error(`Failed to update wiki page version ${versionId}`);
    }
  }

  private async updatePageCurrentVersion(
    db: WikiDatabase,
    pagePk: string,
    versionId: string,
    status: string,
    updatedAt: Date,
  ): Promise<void> {
    const [updated] = await db
      .update(wikiPages)
      .set({
        current_version_id: versionId,
        status,
        updated_at: updatedAt,
      })
      .where(eq(wikiPages.id, pagePk))
      .returning();

    if (updated === undefined) {
      throw new Error(`Failed to update wiki page ${pagePk}`);
    }
  }

  private async withTransaction<T>(callback: (tx: WikiDatabase) => Promise<T>): Promise<T> {
    const db = this.db as WikiDatabase & {
      transaction?: <TResult>(callback: (tx: WikiDatabase) => Promise<TResult>) => Promise<TResult>;
    };

    if (typeof db.transaction === 'function') {
      return db.transaction(callback);
    }

    return callback(this.db);
  }
}

type CurrentVersionSelection = {
  source: string | null;
  frontmatter_json: unknown;
};

function buildPageWhere(tenantId: string, spaceId: string, status?: string, search?: string): SQL {
  const conditions: SQL[] = [eq(wikiPages.tenant_id, tenantId), eq(wikiPages.space_id, spaceId)];

  if (status !== undefined) {
    conditions.push(eq(wikiPages.status, status));
  }
  if (search !== undefined && search.trim().length > 0) {
    conditions.push(ilike(wikiPages.title, `%${escapeLikePattern(search.trim())}%`));
  }

  return and(...conditions) as SQL;
}

function buildVersionWhere(tenantId: string, spaceId: string, wikiPagePk: string): SQL {
  return and(
    eq(wikiPageVersions.tenant_id, tenantId),
    eq(wikiPageVersions.space_id, spaceId),
    eq(wikiPageVersions.wiki_page_pk, wikiPagePk),
  ) as SQL;
}

function buildPageOrder(sort: string): SQL {
  let parsed: ReturnType<typeof parseSortField>;
  try {
    parsed = parseSortField(sort);
  } catch {
    parsed = { field: 'updated_at', direction: 'desc' };
  }

  const columns = {
    created_at: wikiPages.created_at,
    updated_at: wikiPages.updated_at,
    title: wikiPages.title,
    status: wikiPages.status,
  } as const satisfies Record<WikiPageSortField, unknown>;
  const column = columns[parsed.field as WikiPageSortField];

  if (column === undefined) {
    return desc(wikiPages.updated_at);
  }

  return parsed.direction === 'desc' ? desc(column) : asc(column);
}

function toPageResponse(page: WikiPageRow, currentVersion: CurrentVersionSelection | null | undefined): WikiPageResponse {
  return {
    page_id: page.page_id,
    space_id: page.space_id,
    title: page.title,
    status: page.status,
    source: normalizePageSource(currentVersion?.source),
    current_version_id: page.current_version_id,
    indexed_version_id: page.indexed_version_id,
    sync_status: page.sync_status,
    docmost_page_id: page.docmost_page_id,
    tags: readStringArray(readRecord(currentVersion?.frontmatter_json)?.tags),
    citations_count: 0,
    related_nodes_count: 0,
    updated_at: page.updated_at,
  };
}

function toVersionResponse(version: WikiPageVersionRow, currentVersionId: string | null): WikiPageVersionResponse {
  return {
    version_id: version.id,
    content_hash: contentHash(version.content_markdown),
    author: version.created_by === null ? version.source : `user:${version.created_by}`,
    source_run_id: version.graphify_run_id,
    status: version.id === currentVersionId ? 'current' : 'archived',
    created_at: version.created_at,
  };
}

function toReindexResponse(pageId: string, job: JobRow): WikiReindexResponse {
  return {
    page_id: pageId,
    reindex_job_id: job.id,
    status: 'accepted',
  };
}

function toSourceLinkInsert(
  tenantId: string,
  spaceId: string,
  link: CreateSourceLinkInput,
): typeof sourceLinks.$inferInsert {
  const normalized = normalizeSourceLink({
    wiki_page_pk: link.wiki_page_pk,
    page_version_id: link.page_version_id,
    section_id: link.section_id ?? null,
    source_document_id: link.source_document_id ?? null,
    source_uri: link.source_uri ?? null,
    quote_hash: link.quote_hash ?? null,
    evidence_type: link.evidence_type ?? 'reference',
  });

  return {
    id: randomUUID(),
    tenant_id: tenantId,
    space_id: spaceId,
    wiki_page_pk: normalized.wiki_page_pk,
    page_version_id: normalized.page_version_id,
    section_id: normalized.section_id ?? null,
    source_document_id: normalized.source_document_id ?? null,
    source_uri: normalized.source_uri ?? null,
    quote_hash: normalized.quote_hash ?? null,
    evidence_type: normalized.evidence_type,
  };
}

function toCoreSourceLink(link: CreateSourceLinkInput): SourceLink {
  return {
    wiki_page_pk: link.wiki_page_pk,
    page_version_id: link.page_version_id,
    evidence_type: link.evidence_type ?? 'reference',
    ...(link.section_id !== undefined ? { section_id: link.section_id } : {}),
    ...(link.source_document_id !== undefined ? { source_document_id: link.source_document_id } : {}),
    ...(link.source_uri !== undefined ? { source_uri: link.source_uri } : {}),
    ...(link.quote_hash !== undefined ? { quote_hash: link.quote_hash } : {}),
  };
}

function toSourceLinkResponse(row: SourceLinkRow, resolvedSectionId?: string | null): SourceLinkResponse {
  return {
    id: row.id,
    wiki_page_pk: row.wiki_page_pk,
    page_version_id: row.page_version_id,
    section_id: resolvedSectionId ?? row.section_id,
    source_document_id: row.source_document_id,
    source_uri: row.source_uri,
    quote_hash: row.quote_hash,
    evidence_type: row.evidence_type,
    created_at: row.created_at,
  };
}

function readBlocks(value: unknown): WikiPageContentBlock[] {
  const blocks = readRecord(value)?.blocks;
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks.flatMap((block): WikiPageContentBlock[] => {
    const record = readRecord(block);
    if (record === undefined || typeof record.block_id !== 'string') {
      return [];
    }

    const owner = record.owner === 'human' ? 'human' : 'graphify';
    return [
      {
        block_id: record.block_id,
        owner,
        editable: typeof record.editable === 'boolean' ? record.editable : owner === 'human',
      },
    ];
  });
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizePageSource(source: string | null | undefined): string {
  return source === undefined || source === null || source.length === 0 ? 'human' : source;
}

function contentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function normalizePositiveInt(value: number | undefined, fallback: number, max = Number.POSITIVE_INFINITY): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.min(Math.trunc(value), max);
}

function normalizeCount(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function throwApiError(code: ErrorCode | string, message: string, status: HttpStatus): never {
  throw new HttpException({ code, message }, status);
}
