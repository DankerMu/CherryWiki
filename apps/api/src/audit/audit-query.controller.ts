import { Controller, Get, HttpException, HttpStatus, Inject, Query, Req } from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode, audit_logs } from '@cherrygraph/shared';
import { and, asc, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import {
  PaginationQueryDto,
  buildPaginationMeta,
  paginatedResponse,
  parseSortField,
  type PaginatedResponse,
} from '../common/dto/pagination.dto.js';
import { DRIZZLE } from '../database/drizzle.constants.js';

export class AuditLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  actor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  actor_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  space?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  space_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  to?: string;
}

type AuditQueryDatabase = NodePgDatabase;
type AuditLogRow = typeof audit_logs.$inferSelect;
type AuditLogSortField = keyof Pick<
  typeof audit_logs,
  'created_at' | 'action' | 'actor_user_id' | 'resource_type' | 'space_id'
>;

export type AuditLogResponse = {
  id: string;
  actor_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  space_id: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  metadata_json: unknown;
  created_at: Date;
};

type RequestWithAuth = {
  user?: AuthenticatedRequestUser;
};

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

@Permissions('admin:audit_view')
@Controller('admin/audit-logs')
export class AuditQueryController {
  constructor(@Inject(DRIZZLE) private readonly db: AuditQueryDatabase) {}

  @Get()
  async listAuditLogs(
    @Query() query: AuditLogQueryDto,
    @Req() request: RequestWithAuth,
  ): Promise<PaginatedResponse<AuditLogResponse>> {
    const user = getAuthenticatedUser(request);
    const page = normalizePage(query.page);
    const perPage = normalizePerPage(query.per_page);
    const where = buildAuditLogWhere(user.tenant_id, query);
    const order = buildAuditLogOrder(query.sort ?? '-created_at');

    const rows = await this.db
      .select()
      .from(audit_logs)
      .where(where)
      .orderBy(order)
      .limit(perPage)
      .offset((page - 1) * perPage);
    const [countRow] = await this.db.select({ total: count() }).from(audit_logs).where(where);

    return paginatedResponse(
      rows.map(toAuditLogResponse),
      buildPaginationMeta(page, perPage, normalizeCount(countRow?.total)),
    );
  }
}

function buildAuditLogWhere(tenantId: string, query: AuditLogQueryDto): SQL {
  const actor = firstNonEmpty(query.actor, query.actor_id);
  const space = firstNonEmpty(query.space, query.space_id);
  const action = normalizeFilterValue(query.action);
  const conditions: SQL[] = [eq(audit_logs.tenant_id, tenantId)];

  if (actor !== undefined) {
    conditions.push(eq(audit_logs.actor_user_id, actor));
  }

  if (action !== undefined) {
    conditions.push(eq(audit_logs.action, action));
  }

  if (space !== undefined) {
    conditions.push(eq(audit_logs.space_id, space));
  }

  if (query.from !== undefined && query.from.trim().length > 0) {
    conditions.push(gte(audit_logs.created_at, parseDateQuery(query.from, 'from')));
  }

  if (query.to !== undefined && query.to.trim().length > 0) {
    conditions.push(lte(audit_logs.created_at, parseDateQuery(query.to, 'to')));
  }

  const where = and(...conditions);
  if (where === undefined) {
    throw new Error('Expected audit log where clause');
  }

  return where;
}

function buildAuditLogOrder(sort: string): SQL {
  const parsed = parseSortSafely(sort);
  const columns = {
    created_at: audit_logs.created_at,
    action: audit_logs.action,
    actor_user_id: audit_logs.actor_user_id,
    resource_type: audit_logs.resource_type,
    space_id: audit_logs.space_id,
  } as const satisfies Record<AuditLogSortField, unknown>;
  const column = columns[parsed.field as AuditLogSortField];

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

function parseDateQuery(value: string, field: 'from' | 'to'): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throwApiError(
      ErrorCode.VALIDATION_ERROR,
      `Invalid ${field} datetime`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  return date;
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
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeFilterValue(value);
    if (normalized !== undefined) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeFilterValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function toAuditLogResponse(row: AuditLogRow): AuditLogResponse {
  return {
    id: row.id,
    actor_user_id: row.actor_user_id,
    action: row.action,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    space_id: row.space_id,
    ip: row.ip,
    user_agent: row.user_agent,
    request_id: row.request_id,
    metadata_json: row.metadata_json,
    created_at: row.created_at,
  };
}

function getAuthenticatedUser(request: RequestWithAuth): AuthenticatedRequestUser {
  if (request.user === undefined) {
    throwApiError(ErrorCode.UNAUTHENTICATED, 'Unauthenticated', HttpStatus.UNAUTHORIZED);
  }

  return request.user;
}

function throwApiError(code: ErrorCode, message: string, status: HttpStatus): never {
  throw new HttpException({ code, message }, status);
}
