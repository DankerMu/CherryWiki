import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ROLES, normalizeRole } from '@cherrygraph/auth-core';
import { ErrorCode, group_members, space_permissions, spaces, tenants } from '@cherrygraph/shared';
import { and, asc, count, desc, eq, ilike, inArray, ne, or, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';

import { AUDIT_EVENTS } from '../audit/audit-events.js';
import { AuditService } from '../audit/audit.service.js';
import {
  buildPaginationMeta,
  paginatedResponse,
  parseSortField,
  type PaginatedResponse,
} from '../common/dto/pagination.dto.js';
import { DRIZZLE } from '../database/drizzle.constants.js';

type SpaceDatabase = NodePgDatabase;
type SpaceRow = typeof spaces.$inferSelect;
type JsonRecord = Record<string, unknown>;

export type SpaceContext = {
  tenantId?: string;
  actorUserId?: string;
  actorRole?: string;
  userId?: string;
};

export type ListSpacesInput = {
  page?: number;
  per_page?: number;
  sort?: string;
  status?: string;
  search?: string;
};

export type CreateSpaceInput = {
  name: string;
  slug: string;
  description?: string;
};

export type UpdateSpaceInput = {
  name?: string;
  slug?: string;
  description?: string;
  strict_knowledge_only?: boolean;
  graphify_config?: JsonRecord;
  wiki_repo_path?: string;
};

export type SpaceStatsSummary = {
  page_count: number;
  source_count: number;
  node_count: number;
};

export type SpaceListItem = {
  id: string;
  name: string;
  slug: string;
  status: string;
  description: string | null;
  stats: SpaceStatsSummary;
  created_at: Date;
  updated_at: Date;
};

export type SpaceDetail = SpaceListItem & {
  docmost_space_id: string | null;
  wiki_repo_path: string;
  active_graphify_run_id: string | null;
  active_index_snapshot_id: string | null;
  index_consistency_status: string;
  strict_knowledge_only: boolean;
  graphify_config: unknown;
  default_publish_policy: string;
};

export type SpaceStatsResponse = {
  space_id: string;
  page_count: number;
  source_count: number;
  node_count: number;
  edge_count: number;
  index_consistency: string;
};

type SpaceSortField = keyof Pick<typeof spaces, 'created_at' | 'updated_at' | 'name' | 'slug' | 'status'>;

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;
const VIEW_SATISFYING_PERMISSIONS = ['space:view', 'space:edit', 'space:admin'] as const;

@Injectable()
export class SpaceService {
  constructor(
    @Inject(DRIZZLE) private readonly db: SpaceDatabase,
    private readonly auditService: AuditService,
  ) {}

  async listSpaces(
    input: ListSpacesInput = {},
    context: SpaceContext = {},
  ): Promise<PaginatedResponse<SpaceListItem>> {
    const tenantId = await this.resolveTenantId(context);
    const page = normalizePage(input.page);
    const perPage = normalizePerPage(input.per_page);
    const filters = await this.buildListFilters(tenantId, input, context);

    if (filters === undefined) {
      return paginatedResponse([], buildPaginationMeta(page, perPage, 0));
    }

    const where = and(...filters);
    const order = buildSpaceOrder(input.sort ?? '-created_at');
    const rows = await this.db
      .select()
      .from(spaces)
      .where(where)
      .orderBy(order)
      .limit(perPage)
      .offset((page - 1) * perPage);
    const [countRow] = await this.db.select({ total: count() }).from(spaces).where(where);

    return paginatedResponse(
      rows.map(toSpaceListItem),
      buildPaginationMeta(page, perPage, normalizeCount(countRow?.total)),
    );
  }

  async createSpace(input: CreateSpaceInput, context: SpaceContext = {}): Promise<SpaceDetail> {
    const tenantId = await this.resolveTenantId(context);
    const slug = normalizeSlug(input.slug);
    const existing = await findSpaceBySlug(this.db, tenantId, slug);
    if (existing !== undefined) {
      throwApiError(ErrorCode.SPACE_SLUG_CONFLICT, 'Space slug already exists', HttpStatus.CONFLICT);
    }

    const id = randomUUID();
    const now = new Date();

    try {
      const [created] = await this.db
        .insert(spaces)
        .values({
          id,
          tenant_id: tenantId,
          name: input.name.trim(),
          slug,
          description: input.description?.trim() ?? null,
          status: 'active',
          docmost_space_id: null,
          wiki_repo_path: `/data/wiki/${id}`,
          active_graphify_run_id: null,
          active_index_snapshot_id: null,
          index_consistency_status: 'healthy',
          permission_version: 1,
          strict_knowledge_only: true,
          graphify_config: {},
          default_publish_policy: 'editor_publish',
          created_at: now,
          updated_at: now,
        })
        .returning();

      if (created === undefined) {
        throw new Error('Failed to create space');
      }

      this.auditService.push({
        tenant_id: tenantId,
        ...(context.actorUserId !== undefined ? { actor_user_id: context.actorUserId } : {}),
        action: AUDIT_EVENTS.SPACE_CREATE,
        resource_type: 'space',
        resource_id: created.id,
        space_id: created.id,
        metadata_json: {
          name: created.name,
          slug: created.slug,
        },
      });

      return toSpaceDetail(created);
    } catch (err) {
      if (isUniqueViolation(err, 'spaces_tenant_id_slug_unique')) {
        throwApiError(ErrorCode.SPACE_SLUG_CONFLICT, 'Space slug already exists', HttpStatus.CONFLICT);
      }

      throw err;
    }
  }

  async getSpace(spaceId: string, context: SpaceContext = {}): Promise<SpaceDetail> {
    const tenantId = await this.resolveTenantId(context);
    const space = await findSpaceById(this.db, tenantId, spaceId);
    if (space === undefined) {
      throwSpaceNotFound();
    }

    if (!hasImplicitSpaceAccess(context.actorRole)) {
      const userId = resolveContextUserId(context);
      const allowed = await this.hasSpaceViewPermission(tenantId, userId, spaceId);
      if (!allowed) {
        throwSpaceNotFound();
      }
    }

    return toSpaceDetail(space);
  }

  async updateSpace(
    spaceId: string,
    input: UpdateSpaceInput,
    context: SpaceContext = {},
  ): Promise<SpaceDetail> {
    const tenantId = await this.resolveTenantId(context);
    const existing = await findSpaceById(this.db, tenantId, spaceId);
    if (existing === undefined) {
      throwSpaceNotFound();
    }

    const updateValues: Partial<typeof spaces.$inferInsert> = {
      updated_at: new Date(),
    };
    const changedFields: string[] = [];

    if (input.name !== undefined && input.name.trim() !== existing.name) {
      updateValues.name = input.name.trim();
      changedFields.push('name');
    }

    if (input.slug !== undefined) {
      const slug = normalizeSlug(input.slug);
      if (slug !== existing.slug) {
        await this.assertSlugAvailable(tenantId, slug, spaceId);
        updateValues.slug = slug;
        changedFields.push('slug');
      }
    }

    if (input.description !== undefined && input.description.trim() !== (existing.description ?? '')) {
      updateValues.description = input.description.trim();
      changedFields.push('description');
    }

    if (
      input.strict_knowledge_only !== undefined &&
      input.strict_knowledge_only !== existing.strict_knowledge_only
    ) {
      updateValues.strict_knowledge_only = input.strict_knowledge_only;
      changedFields.push('strict_knowledge_only');
    }

    if (input.graphify_config !== undefined) {
      updateValues.graphify_config = input.graphify_config;
      changedFields.push('graphify_config');
    }

    if (changedFields.length === 0) {
      return toSpaceDetail(existing);
    }

    try {
      const [updated] = await this.db
        .update(spaces)
        .set(updateValues)
        .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.id, spaceId)))
        .returning();

      if (updated === undefined) {
        throw new Error('Failed to update space');
      }

      this.auditService.push({
        tenant_id: tenantId,
        ...(context.actorUserId !== undefined ? { actor_user_id: context.actorUserId } : {}),
        action: AUDIT_EVENTS.SPACE_UPDATE,
        resource_type: 'space',
        resource_id: updated.id,
        space_id: updated.id,
        metadata_json: {
          changed_fields: changedFields,
        },
      });

      return toSpaceDetail(updated);
    } catch (err) {
      if (isUniqueViolation(err, 'spaces_tenant_id_slug_unique')) {
        throwApiError(ErrorCode.SPACE_SLUG_CONFLICT, 'Space slug already exists', HttpStatus.CONFLICT);
      }

      throw err;
    }
  }

  async getStats(spaceId: string, context: SpaceContext = {}): Promise<SpaceStatsResponse> {
    const tenantId = await this.resolveTenantId(context);
    const space = await findSpaceById(this.db, tenantId, spaceId);
    if (space === undefined) {
      throwSpaceNotFound();
    }

    if (!hasImplicitSpaceAccess(context.actorRole)) {
      const userId = resolveContextUserId(context);
      const allowed = await this.hasSpaceViewPermission(tenantId, userId, spaceId);
      if (!allowed) {
        throwSpaceNotFound();
      }
    }

    return toSpaceStats(space);
  }

  private async buildListFilters(
    tenantId: string,
    input: ListSpacesInput,
    context: SpaceContext,
  ): Promise<SQL[] | undefined> {
    const filters: SQL[] = [eq(spaces.tenant_id, tenantId)];

    if (!hasImplicitSpaceAccess(context.actorRole)) {
      const userId = resolveContextUserId(context);
      const accessibleSpaceIds = await this.getAccessibleSpaceIds(tenantId, userId);
      if (accessibleSpaceIds.length === 0) {
        return undefined;
      }

      filters.push(inArray(spaces.id, accessibleSpaceIds));
    }

    if (input.status !== undefined && input.status.trim().length > 0) {
      filters.push(eq(spaces.status, input.status.trim()));
    }

    if (input.search !== undefined && input.search.trim().length > 0) {
      const pattern = `%${escapeLikePattern(input.search.trim())}%`;
      const searchFilter = or(
        ilike(spaces.name, pattern),
        ilike(spaces.slug, pattern),
        ilike(spaces.description, pattern),
      );
      if (searchFilter !== undefined) {
        filters.push(searchFilter);
      }
    }

    return filters;
  }

  private async getAccessibleSpaceIds(tenantId: string, userId: string): Promise<string[]> {
    const rows = await this.db
      .select({
        space_id: space_permissions.space_id,
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
          inArray(space_permissions.permission, [...VIEW_SATISFYING_PERMISSIONS]),
        ),
      );

    return [...new Set(rows.map((row) => row.space_id))];
  }

  private async hasSpaceViewPermission(
    tenantId: string,
    userId: string,
    spaceId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({
        space_id: space_permissions.space_id,
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
          inArray(space_permissions.permission, [...VIEW_SATISFYING_PERMISSIONS]),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  private async assertSlugAvailable(
    tenantId: string,
    slug: string,
    currentSpaceId: string,
  ): Promise<void> {
    const [conflict] = await this.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.slug, slug), ne(spaces.id, currentSpaceId)))
      .limit(1);

    if (conflict !== undefined) {
      throwApiError(ErrorCode.SPACE_SLUG_CONFLICT, 'Space slug already exists', HttpStatus.CONFLICT);
    }
  }

  private async resolveTenantId(context: SpaceContext): Promise<string> {
    if (context.tenantId !== undefined && context.tenantId.trim().length > 0) {
      return context.tenantId.trim();
    }

    const configuredTenantId = process.env.DEFAULT_TENANT_ID;
    if (configuredTenantId !== undefined && configuredTenantId.trim().length > 0) {
      return configuredTenantId.trim();
    }

    const [tenant] = await this.db.select({ id: tenants.id }).from(tenants).limit(1);
    if (tenant === undefined) {
      throw new Error('No tenant configured');
    }

    return tenant.id;
  }
}

function buildSpaceOrder(sort: string): SQL {
  const parsed = parseSortSafely(sort);
  const columns = {
    created_at: spaces.created_at,
    updated_at: spaces.updated_at,
    name: spaces.name,
    slug: spaces.slug,
    status: spaces.status,
  } as const satisfies Record<SpaceSortField, unknown>;
  const column = columns[parsed.field as SpaceSortField];

  if (column === undefined) {
    throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid sort field', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  return parsed.direction === 'desc' ? desc(column) : asc(column);
}

function parseSortSafely(sort: string): ReturnType<typeof parseSortField> {
  try {
    return parseSortField(sort);
  } catch {
    throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid sort field', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

async function findSpaceById(
  db: SpaceDatabase,
  tenantId: string,
  spaceId: string,
): Promise<SpaceRow | undefined> {
  const [space] = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.id, spaceId)))
    .limit(1);

  return space;
}

async function findSpaceBySlug(
  db: SpaceDatabase,
  tenantId: string,
  slug: string,
): Promise<Pick<SpaceRow, 'id'> | undefined> {
  const [space] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.slug, slug)))
    .limit(1);

  return space;
}

function hasImplicitSpaceAccess(role: string | undefined): boolean {
  const normalized = role === undefined ? undefined : normalizeRole(role);
  return normalized === ROLES.OWNER || normalized === ROLES.ADMIN;
}

function resolveContextUserId(context: SpaceContext): string {
  const userId = context.userId ?? context.actorUserId;
  if (userId !== undefined && userId.trim().length > 0) {
    return userId.trim();
  }

  throwApiError(ErrorCode.UNAUTHENTICATED, 'Unauthenticated', HttpStatus.UNAUTHORIZED);
}

function toSpaceListItem(row: SpaceRow): SpaceListItem {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    description: row.description,
    stats: {
      page_count: 0,
      source_count: 0,
      node_count: 0,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toSpaceDetail(row: SpaceRow): SpaceDetail {
  return {
    ...toSpaceListItem(row),
    docmost_space_id: row.docmost_space_id,
    wiki_repo_path: row.wiki_repo_path,
    active_graphify_run_id: row.active_graphify_run_id,
    active_index_snapshot_id: row.active_index_snapshot_id,
    index_consistency_status: row.index_consistency_status,
    strict_knowledge_only: row.strict_knowledge_only,
    graphify_config: row.graphify_config,
    default_publish_policy: row.default_publish_policy,
  };
}

function toSpaceStats(row: SpaceRow): SpaceStatsResponse {
  return {
    space_id: row.id,
    page_count: 0,
    source_count: 0,
    node_count: 0,
    edge_count: 0,
    index_consistency: row.index_consistency_status,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function normalizeSlug(slug: string): string {
  return slug.trim();
}

function normalizePage(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : DEFAULT_PAGE;
}

function normalizePerPage(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined || value < 1) {
    return DEFAULT_PER_PAGE;
  }

  return Math.min(value, MAX_PER_PAGE);
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function throwSpaceNotFound(): never {
  throwApiError(ErrorCode.SPACE_NOT_FOUND, 'Space not found', HttpStatus.NOT_FOUND);
}

function throwApiError(code: ErrorCode, message: string, status: HttpStatus): never {
  throw new HttpException({ code, message }, status);
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (!isRecord(err)) {
    return false;
  }

  return err.code === '23505' && err.constraint === constraint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
