import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  mcpInvokeDto,
  mcpToolCreateDto,
  mcpToolPolicyDto,
  mcpToolRegistry,
  type McpInvokeDto,
  type McpToolCreateDto,
  type McpToolPolicyDto,
} from '@cherrygraph/shared';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';

import { AuditService } from '../audit/audit.service.js';
import type { ApiTokenAuthenticatedUser } from '../api-tokens/api-token.service.js';
import { throwApiError } from '../common/errors/api-error.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { checkMcpAuthorization, normalizeMcpPolicy } from './mcp-policy.js';
import { McpRateLimiter } from './mcp-rate-limit.js';

type McpDatabase = NodePgDatabase;
type McpToolRow = typeof mcpToolRegistry.$inferSelect;
type McpToolInsert = typeof mcpToolRegistry.$inferInsert;
type JsonRecord = Record<string, unknown>;

export type McpAuditContext = {
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

export type McpActorContext = {
  tenantId: string;
  actorUserId: string;
  audit?: McpAuditContext | undefined;
};

export type McpInvokeContext = {
  caller?: unknown;
  audit?: McpAuditContext | undefined;
  response?: McpResponseLike | undefined;
};

export type McpToolListInput = {
  include_inactive?: boolean | string;
};

export type McpResponseLike = {
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
  raw?: {
    setHeader?: (name: string, value: string) => unknown;
  };
};

const UNIQUE_TOOL_NAME_CONSTRAINT = 'mcp_tool_registry_tenant_id_tool_name_unique';
const FETCH_TIMEOUT_MS = 30_000;
const ARGUMENT_SUMMARY_MAX_CHARS = 500;
const SENSITIVE_ARGUMENT_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'authorization',
  'cookie',
  'secret',
]);

@Injectable()
export class McpService {
  constructor(
    @Inject(DRIZZLE) private readonly db: McpDatabase,
    private readonly auditService: AuditService,
    private readonly rateLimiter: McpRateLimiter,
  ) {}

  async createTool(input: unknown, context: McpActorContext): Promise<McpToolRow> {
    const parsed = parseToolCreateInput(input);
    const existing = await this.findToolByName(parsed.tool_name, context.tenantId);
    if (existing !== undefined) {
      throwApiError(ErrorCode.TOOL_NAME_EXISTS, 'MCP tool name already exists', HttpStatus.CONFLICT);
    }

    const now = new Date();
    try {
      const [created] = await this.db
        .insert(mcpToolRegistry)
        .values({
          id: randomUUID(),
          tenant_id: context.tenantId,
          tool_name: parsed.tool_name,
          description: parsed.description ?? null,
          server_url: parsed.server_url,
          transport: parsed.transport,
          input_schema: parsed.input_schema,
          scopes: [...parsed.scopes],
          status: 'active',
          policy_json: {},
          created_by: context.actorUserId,
          created_at: now,
          updated_at: now,
        } satisfies McpToolInsert)
        .returning();

      if (created === undefined) {
        throw new Error('Failed to create MCP tool');
      }

      this.auditService.push({
        tenant_id: context.tenantId,
        actor_user_id: context.actorUserId,
        action: 'mcp.tool.registered',
        resource_type: 'mcp_tool',
        resource_id: created.id,
        ...toAuditFields(context.audit),
        metadata_json: {
          tool_name: created.tool_name,
          transport: created.transport,
          scopes: created.scopes,
        },
      });

      return created;
    } catch (err) {
      if (isUniqueViolation(err, UNIQUE_TOOL_NAME_CONSTRAINT)) {
        throwApiError(ErrorCode.TOOL_NAME_EXISTS, 'MCP tool name already exists', HttpStatus.CONFLICT);
      }

      throw err;
    }
  }

  async listTools(input: McpToolListInput, context: McpActorContext): Promise<McpToolRow[]> {
    const filters: SQL[] = [eq(mcpToolRegistry.tenant_id, context.tenantId)];
    if (!shouldIncludeInactive(input.include_inactive)) {
      filters.push(eq(mcpToolRegistry.status, 'active'));
    }

    return this.db
      .select()
      .from(mcpToolRegistry)
      .where(and(...filters))
      .orderBy(desc(mcpToolRegistry.created_at));
  }

  async deleteTool(toolId: string, context: McpActorContext): Promise<McpToolRow> {
    const existing = await this.findToolById(toolId, context.tenantId);
    if (existing === undefined) {
      throwApiError(ErrorCode.TOOL_NOT_FOUND, 'MCP tool not found', HttpStatus.NOT_FOUND);
    }

    const [updated] = await this.db
      .update(mcpToolRegistry)
      .set({
        status: 'inactive',
        updated_at: new Date(),
      } satisfies Partial<McpToolInsert>)
      .where(and(eq(mcpToolRegistry.tenant_id, context.tenantId), eq(mcpToolRegistry.id, toolId)))
      .returning();

    if (updated === undefined) {
      throwApiError(ErrorCode.TOOL_NOT_FOUND, 'MCP tool not found', HttpStatus.NOT_FOUND);
    }

    this.auditService.push({
      tenant_id: context.tenantId,
      actor_user_id: context.actorUserId,
      action: 'mcp.tool.deleted',
      resource_type: 'mcp_tool',
      resource_id: updated.id,
      ...toAuditFields(context.audit),
      metadata_json: {
        tool_name: updated.tool_name,
      },
    });

    return updated;
  }

  async updatePolicy(toolId: string, input: unknown, context: McpActorContext): Promise<McpToolRow> {
    const parsed = parsePolicyInput(input);
    const existing = await this.findToolById(toolId, context.tenantId);
    if (existing === undefined) {
      throwApiError(ErrorCode.TOOL_NOT_FOUND, 'MCP tool not found', HttpStatus.NOT_FOUND);
    }

    const [updated] = await this.db
      .update(mcpToolRegistry)
      .set({
        policy_json: parsed,
        updated_at: new Date(),
      } satisfies Partial<McpToolInsert>)
      .where(and(eq(mcpToolRegistry.tenant_id, context.tenantId), eq(mcpToolRegistry.id, toolId)))
      .returning();

    if (updated === undefined) {
      throwApiError(ErrorCode.TOOL_NOT_FOUND, 'MCP tool not found', HttpStatus.NOT_FOUND);
    }

    return updated;
  }

  async invokeTool(input: unknown, context: McpInvokeContext): Promise<unknown> {
    const caller = requireApiTokenCaller(context.caller);
    const parsed = parseInvokeInput(input);
    const start = Date.now();
    const tool = await this.findActiveToolByName(parsed.tool_name, caller.tenant_id);

    if (tool === undefined) {
      this.auditInvocation('mcp.tool.error', {
        tenantId: caller.tenant_id,
        actorUserId: caller.sub,
        tokenId: caller.token_id,
        spaceId: parsed.space_id,
        toolName: parsed.tool_name,
        durationMs: elapsed(start),
        argumentsValue: parsed.arguments,
        audit: context.audit,
        metadata: {
          error_code: ErrorCode.TOOL_NOT_FOUND,
        },
      });
      throwApiError(ErrorCode.TOOL_NOT_FOUND, 'MCP tool not found', HttpStatus.NOT_FOUND);
    }

    const authorization = checkMcpAuthorization({
      tokenScopes: caller.scopes,
      tokenRole: caller.role,
      spaceId: parsed.space_id,
      policy: tool.policy_json,
    });

    if (!authorization.authorized) {
      this.auditInvocation('mcp.tool.denied', {
        tenantId: caller.tenant_id,
        actorUserId: caller.sub,
        tokenId: caller.token_id,
        spaceId: parsed.space_id,
        toolId: tool.id,
        toolName: tool.tool_name,
        durationMs: elapsed(start),
        argumentsValue: parsed.arguments,
        audit: context.audit,
        metadata: {
          denial_reason: authorization.denial_reason ?? 'unknown',
        },
      });
      throwApiError(ErrorCode.PERMISSION_DENIED, 'MCP tool invocation denied', HttpStatus.FORBIDDEN);
    }

    const rateLimit = await this.rateLimiter.check({
      tenantId: caller.tenant_id,
      actorUserId: caller.sub,
      tokenId: caller.token_id,
      toolId: tool.id,
      toolName: tool.tool_name,
      spaceId: parsed.space_id,
      limitRpm: readRateLimitRpm(tool.policy_json),
      audit: context.audit,
    });

    if (rateLimit.limited) {
      setResponseHeader(context.response, 'Retry-After', String(rateLimit.retryAfter));
      this.auditInvocation('mcp.rate_limit.exceeded', {
        tenantId: caller.tenant_id,
        actorUserId: caller.sub,
        tokenId: caller.token_id,
        spaceId: parsed.space_id,
        toolId: tool.id,
        toolName: tool.tool_name,
        durationMs: elapsed(start),
        argumentsValue: parsed.arguments,
        audit: context.audit,
        metadata: {
          retry_after_seconds: rateLimit.retryAfter,
          rate_limit_rpm: readRateLimitRpm(tool.policy_json) ?? null,
        },
      });
      throwApiError(ErrorCode.RATE_LIMITED, 'MCP rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    let response: Response;
    try {
      response = await forwardToMcpServer(tool, parsed);
    } catch (err) {
      const timeout = isTimeoutError(err);
      const code = timeout ? ErrorCode.MCP_SERVER_TIMEOUT : ErrorCode.MCP_SERVER_ERROR;
      this.auditInvocation('mcp.tool.error', {
        tenantId: caller.tenant_id,
        actorUserId: caller.sub,
        tokenId: caller.token_id,
        spaceId: parsed.space_id,
        toolId: tool.id,
        toolName: tool.tool_name,
        durationMs: elapsed(start),
        argumentsValue: parsed.arguments,
        audit: context.audit,
        metadata: {
          error_code: code,
          error_message: err instanceof Error ? err.message : String(err),
        },
      });
      throwApiError(
        code,
        timeout ? 'MCP server timed out' : 'MCP server request failed',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const responsePayload = await readMcpResponse(response);
    const durationMs = elapsed(start);

    if (!response.ok) {
      this.auditInvocation('mcp.tool.error', {
        tenantId: caller.tenant_id,
        actorUserId: caller.sub,
        tokenId: caller.token_id,
        spaceId: parsed.space_id,
        toolId: tool.id,
        toolName: tool.tool_name,
        durationMs,
        argumentsValue: parsed.arguments,
        audit: context.audit,
        metadata: {
          error_code: ErrorCode.MCP_SERVER_ERROR,
          status_code: response.status,
        },
      });
      throwApiError(ErrorCode.MCP_SERVER_ERROR, 'MCP server returned an error', HttpStatus.BAD_GATEWAY);
    }

    this.auditInvocation('mcp.tool.invoked', {
      tenantId: caller.tenant_id,
      actorUserId: caller.sub,
      tokenId: caller.token_id,
      spaceId: parsed.space_id,
      toolId: tool.id,
      toolName: tool.tool_name,
      durationMs,
      argumentsValue: parsed.arguments,
      audit: context.audit,
    });

    return responsePayload;
  }

  private async findToolByName(toolName: string, tenantId: string): Promise<McpToolRow | undefined> {
    const [row] = await this.db
      .select()
      .from(mcpToolRegistry)
      .where(and(eq(mcpToolRegistry.tenant_id, tenantId), eq(mcpToolRegistry.tool_name, toolName)))
      .limit(1);

    return row;
  }

  private async findActiveToolByName(toolName: string, tenantId: string): Promise<McpToolRow | undefined> {
    const [row] = await this.db
      .select()
      .from(mcpToolRegistry)
      .where(
        and(
          eq(mcpToolRegistry.tenant_id, tenantId),
          eq(mcpToolRegistry.tool_name, toolName),
          eq(mcpToolRegistry.status, 'active'),
        ),
      )
      .limit(1);

    return row;
  }

  private async findToolById(toolId: string, tenantId: string): Promise<McpToolRow | undefined> {
    const [row] = await this.db
      .select()
      .from(mcpToolRegistry)
      .where(and(eq(mcpToolRegistry.tenant_id, tenantId), eq(mcpToolRegistry.id, toolId)))
      .limit(1);

    return row;
  }

  private auditInvocation(
    action: 'mcp.tool.invoked' | 'mcp.tool.denied' | 'mcp.tool.error' | 'mcp.rate_limit.exceeded',
    params: {
      tenantId: string;
      actorUserId: string;
      tokenId: string;
      spaceId: string;
      toolName: string;
      durationMs: number;
      argumentsValue: JsonRecord;
      audit?: McpAuditContext | undefined;
      toolId?: string;
      metadata?: JsonRecord;
    },
  ): void {
    this.auditService.push({
      tenant_id: params.tenantId,
      actor_user_id: params.actorUserId,
      action,
      resource_type: 'mcp_tool',
      ...(params.toolId !== undefined ? { resource_id: params.toolId } : {}),
      space_id: params.spaceId,
      ...toAuditFields(params.audit),
      metadata_json: {
        tool_name: params.toolName,
        caller_token_id: params.tokenId,
        space_id: params.spaceId,
        duration_ms: params.durationMs,
        argument_summary: summarizeArguments(params.argumentsValue),
        ...(params.metadata ?? {}),
      },
    });
  }
}

async function forwardToMcpServer(tool: McpToolRow, input: McpInvokeDto): Promise<Response> {
  return fetch(tool.server_url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      tool: input.tool_name,
      arguments: input.arguments,
      space_id: input.space_id,
      transport: tool.transport,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function readMcpResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text.length === 0 ? null : text;
}

function parseToolCreateInput(input: unknown): McpToolCreateDto {
  const parsed = mcpToolCreateDto.safeParse(applyToolNameAlias(input));
  if (parsed.success) {
    return parsed.data;
  }

  throwValidationError(parsed.error);
}

function parsePolicyInput(input: unknown): McpToolPolicyDto {
  const parsed = mcpToolPolicyDto.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  throwValidationError(parsed.error);
}

function parseInvokeInput(input: unknown): McpInvokeDto {
  const parsed = mcpInvokeDto.safeParse(applyInvokeToolAlias(input));
  if (parsed.success) {
    return parsed.data;
  }

  throwValidationError(parsed.error);
}

function applyToolNameAlias(input: unknown): unknown {
  if (!isRecord(input) || input.tool_name !== undefined || typeof input.name !== 'string') {
    return input;
  }

  return {
    ...input,
    tool_name: input.name,
  };
}

function applyInvokeToolAlias(input: unknown): unknown {
  if (!isRecord(input) || input.tool_name !== undefined || typeof input.tool !== 'string') {
    return input;
  }

  return {
    ...input,
    tool_name: input.tool,
  };
}

function requireApiTokenCaller(caller: unknown): ApiTokenAuthenticatedUser {
  if (!isRecord(caller) || typeof caller.token_id !== 'string' || caller.token_id.length === 0) {
    throwApiError(ErrorCode.UNAUTHENTICATED, 'API token authentication is required', HttpStatus.UNAUTHORIZED);
  }

  if (
    typeof caller.sub !== 'string' ||
    typeof caller.tenant_id !== 'string' ||
    typeof caller.role !== 'string' ||
    !Array.isArray(caller.scopes)
  ) {
    throwApiError(ErrorCode.INVALID_TOKEN, 'Invalid API token context', HttpStatus.UNAUTHORIZED);
  }

  return {
    sub: caller.sub,
    tenant_id: caller.tenant_id,
    email: typeof caller.email === 'string' ? caller.email : '',
    role: caller.role,
    group_ids: Array.isArray(caller.group_ids)
      ? caller.group_ids.filter((value): value is string => typeof value === 'string')
      : [],
    token_use: 'access',
    scopes: caller.scopes.filter((value): value is string => typeof value === 'string'),
    token_id: caller.token_id,
  };
}

function readRateLimitRpm(policy: unknown): number | undefined {
  const rateLimit = normalizeMcpPolicy(policy).rate_limit_rpm;
  if (rateLimit === undefined || rateLimit <= 0) {
    return undefined;
  }

  return rateLimit;
}

function summarizeArguments(value: JsonRecord): string {
  const serialized = JSON.stringify(sanitizeArguments(value));
  return serialized.length <= ARGUMENT_SUMMARY_MAX_CHARS
    ? serialized
    : serialized.slice(0, ARGUMENT_SUMMARY_MAX_CHARS);
}

function sanitizeArguments(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeArguments);
  }

  if (!isRecord(value)) {
    return value;
  }

  const sanitized: JsonRecord = {};
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = isSensitiveArgumentKey(key) ? '[redacted]' : sanitizeArguments(item);
  }

  return sanitized;
}

function isSensitiveArgumentKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_ARGUMENT_KEYS.has(normalized) || normalized.startsWith('secret_');
}

function shouldIncludeInactive(value: boolean | string | undefined): boolean {
  return value === true || value === 'true';
}

function setResponseHeader(response: McpResponseLike | undefined, name: string, value: string): void {
  if (typeof response?.header === 'function') {
    response.header(name, value);
    return;
  }

  if (typeof response?.setHeader === 'function') {
    response.setHeader(name, value);
    return;
  }

  response?.raw?.setHeader?.(name, value);
}

function elapsed(start: number): number {
  return Math.max(0, Date.now() - start);
}

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout/i.test(err.message))
  );
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  return (
    isRecord(err) &&
    err.code === '23505' &&
    (err.constraint === constraint || typeof err.constraint !== 'string')
  );
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

function toAuditFields(audit: McpAuditContext | undefined): Pick<
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
