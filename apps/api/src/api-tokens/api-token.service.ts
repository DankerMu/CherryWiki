import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  apiTokenCreateDto,
  apiTokens,
  users,
  type ApiTokenCreateDto,
} from '@cherrygraph/shared';
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ZodError } from 'zod';

import { AuditService } from '../audit/audit.service.js';
import { DRIZZLE } from '../database/drizzle.constants.js';

type ApiTokenDatabase = NodePgDatabase;
type ApiTokenRow = typeof apiTokens.$inferSelect;
type ApiTokenInsert = typeof apiTokens.$inferInsert;

export type ApiTokenAuditContext = {
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

export type ApiTokenActorContext = {
  tenantId: string;
  actorUserId: string;
  audit?: ApiTokenAuditContext;
};

export type ApiTokenCreateResponse = ApiTokenListItem & {
  raw_token: string;
};

export type ApiTokenListItem = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
};

export type ApiTokenRevokeResponse = {
  id: string;
  revoked_at: Date | null;
};

export type ApiTokenListInput = {
  include_revoked?: boolean | string;
};

export type ApiTokenAuthenticatedUser = {
  sub: string;
  tenant_id: string;
  email: string;
  role: string;
  group_ids: string[];
  token_use: 'access';
  scopes: string[];
  token_id: string;
};

const TOKEN_PREFIX = 'cwt_';
const TOKEN_RANDOM_BYTE_LENGTH = 32;
const TOKEN_PREFIX_DISPLAY_LENGTH = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ApiTokenService {
  constructor(
    @Inject(DRIZZLE) private readonly db: ApiTokenDatabase,
    private readonly auditService: AuditService,
  ) {}

  async createToken(input: unknown, context: ApiTokenActorContext): Promise<ApiTokenCreateResponse> {
    const parsed = parseCreateInput(input);
    const now = new Date();
    const rawToken = generateRawToken();
    const tokenHash = hashRawToken(rawToken);
    const expiresAt =
      parsed.expires_in_days === undefined ? null : new Date(now.getTime() + parsed.expires_in_days * DAY_MS);

    const [created] = await this.db
      .insert(apiTokens)
      .values({
        id: randomUUID(),
        tenant_id: context.tenantId,
        user_id: context.actorUserId,
        name: parsed.name,
        token_hash: tokenHash,
        token_prefix: rawToken.slice(0, TOKEN_PREFIX_DISPLAY_LENGTH),
        scopes: [...parsed.scopes],
        expires_at: expiresAt,
        created_at: now,
      } satisfies ApiTokenInsert)
      .returning();

    if (created === undefined) {
      throw new Error('Failed to create API token');
    }

    this.auditService.push({
      tenant_id: context.tenantId,
      actor_user_id: context.actorUserId,
      action: 'api_token.created',
      resource_type: 'api_token',
      resource_id: created.id,
      ...toAuditFields(context.audit),
      metadata_json: {
        name: created.name,
        token_prefix: created.token_prefix,
        scopes: created.scopes,
        expires_at: created.expires_at?.toISOString() ?? null,
      },
    });

    return {
      ...toListItem(created),
      raw_token: rawToken,
    };
  }

  async listTokens(input: ApiTokenListInput, context: ApiTokenActorContext): Promise<ApiTokenListItem[]> {
    const filters = buildListFilters(context.tenantId, shouldIncludeRevoked(input.include_revoked));
    const rows = await this.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        token_prefix: apiTokens.token_prefix,
        scopes: apiTokens.scopes,
        last_used_at: apiTokens.last_used_at,
        expires_at: apiTokens.expires_at,
        created_at: apiTokens.created_at,
      })
      .from(apiTokens)
      .where(and(...filters))
      .orderBy(desc(apiTokens.created_at));

    return rows.map(normalizeListItem);
  }

  async revokeToken(tokenId: string, context: ApiTokenActorContext): Promise<ApiTokenRevokeResponse> {
    const existing = await this.findTokenForTenant(tokenId, context.tenantId);
    if (existing === undefined) {
      throwApiError(ErrorCode.NOT_FOUND, 'API token not found', HttpStatus.NOT_FOUND);
    }

    if (existing.revoked_at !== null) {
      return {
        id: existing.id,
        revoked_at: existing.revoked_at,
      };
    }

    const revokedAt = new Date();
    const [updated] = await this.db
      .update(apiTokens)
      .set({ revoked_at: revokedAt } satisfies Partial<ApiTokenInsert>)
      .where(and(eq(apiTokens.tenant_id, context.tenantId), eq(apiTokens.id, tokenId), isNull(apiTokens.revoked_at)))
      .returning();

    if (updated === undefined) {
      const token = await this.findTokenForTenant(tokenId, context.tenantId);
      if (token !== undefined) {
        return {
          id: token.id,
          revoked_at: token.revoked_at,
        };
      }

      throwApiError(ErrorCode.NOT_FOUND, 'API token not found', HttpStatus.NOT_FOUND);
    }

    this.auditService.push({
      tenant_id: context.tenantId,
      actor_user_id: context.actorUserId,
      action: 'api_token.revoked',
      resource_type: 'api_token',
      resource_id: updated.id,
      ...toAuditFields(context.audit),
      metadata_json: {
        token_prefix: updated.token_prefix,
      },
    });

    return {
      id: updated.id,
      revoked_at: updated.revoked_at,
    };
  }

  async authenticateRawToken(rawToken: string): Promise<ApiTokenAuthenticatedUser> {
    if (!rawToken.startsWith(TOKEN_PREFIX)) {
      throwApiError(ErrorCode.INVALID_TOKEN, 'Invalid API token', HttpStatus.UNAUTHORIZED);
    }

    const [token] = await this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.token_hash, hashRawToken(rawToken)))
      .limit(1);

    if (token === undefined) {
      throwApiError(ErrorCode.INVALID_TOKEN, 'Invalid API token', HttpStatus.UNAUTHORIZED);
    }

    if (token.revoked_at !== null) {
      throwApiError(ErrorCode.TOKEN_REVOKED, 'API token has been revoked', HttpStatus.UNAUTHORIZED);
    }

    const now = new Date();
    if (token.expires_at !== null && token.expires_at.getTime() <= now.getTime()) {
      throwApiError(ErrorCode.TOKEN_EXPIRED, 'API token has expired', HttpStatus.UNAUTHORIZED);
    }

    const [owner] = await this.db
      .select({
        id: users.id,
        tenant_id: users.tenant_id,
        email: users.email,
        role: users.role,
        status: users.status,
      })
      .from(users)
      .where(and(eq(users.tenant_id, token.tenant_id), eq(users.id, token.user_id)))
      .limit(1);

    if (owner === undefined) {
      throwApiError(ErrorCode.INVALID_TOKEN, 'API token owner not found', HttpStatus.UNAUTHORIZED);
    }

    if (owner.status !== 'active') {
      throwApiError(ErrorCode.INVALID_TOKEN, 'API token owner account is disabled', HttpStatus.UNAUTHORIZED);
    }

    await this.db
      .update(apiTokens)
      .set({ last_used_at: now } satisfies Partial<ApiTokenInsert>)
      .where(eq(apiTokens.id, token.id));

    return {
      sub: owner.id,
      tenant_id: owner.tenant_id,
      email: owner.email,
      role: owner.role,
      group_ids: [],
      token_use: 'access',
      scopes: [...token.scopes],
      token_id: token.id,
    };
  }

  private async findTokenForTenant(tokenId: string, tenantId: string): Promise<ApiTokenRow | undefined> {
    const [token] = await this.db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.tenant_id, tenantId), eq(apiTokens.id, tokenId)))
      .limit(1);

    return token;
  }
}

export function hashRawToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function generateRawToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_RANDOM_BYTE_LENGTH).toString('hex')}`;
}

function parseCreateInput(input: unknown): ApiTokenCreateDto {
  const parsed = apiTokenCreateDto.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  throwValidationError(parsed.error);
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

function buildListFilters(tenantId: string, includeRevoked: boolean): SQL[] {
  const filters: SQL[] = [eq(apiTokens.tenant_id, tenantId)];
  if (!includeRevoked) {
    filters.push(isNull(apiTokens.revoked_at));
  }

  return filters;
}

function shouldIncludeRevoked(value: boolean | string | undefined): boolean {
  return value === true || value === 'true';
}

function toListItem(row: ApiTokenRow): ApiTokenListItem {
  return {
    id: row.id,
    name: row.name,
    token_prefix: row.token_prefix,
    scopes: [...row.scopes],
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

function normalizeListItem(row: ApiTokenListItem): ApiTokenListItem {
  return {
    id: row.id,
    name: row.name,
    token_prefix: row.token_prefix,
    scopes: [...row.scopes],
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

function toAuditFields(audit: ApiTokenAuditContext | undefined): Pick<
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
