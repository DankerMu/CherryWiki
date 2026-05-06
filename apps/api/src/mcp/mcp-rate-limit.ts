import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service.js';
import { getApiLogger } from '../common/logger/logger.module.js';
import { REDIS_CLIENT } from '../common/redis/redis.module.js';
import type { McpAuditContext } from './mcp.service.js';

export type McpRateLimitRedisClient = {
  zadd: (key: string, score: number, member: string) => Promise<number | string>;
  zremrangebyscore: (key: string, min: number | string, max: number | string) => Promise<number>;
  zcard: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
};

export type McpRateLimitParams = {
  tenantId: string;
  actorUserId: string;
  tokenId: string;
  toolId: string;
  toolName: string;
  spaceId: string;
  limitRpm: number | undefined;
  audit?: McpAuditContext | undefined;
};

export type McpRateLimitResult =
  | {
      limited: false;
    }
  | {
      limited: true;
      retryAfter: number;
    };

const WINDOW_SECONDS = 60;
const WINDOW_MS = WINDOW_SECONDS * 1000;

@Injectable()
export class McpRateLimiter {
  constructor(
    private readonly auditService: AuditService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: McpRateLimitRedisClient,
  ) {}

  async check(params: McpRateLimitParams): Promise<McpRateLimitResult> {
    const limit = normalizeLimit(params.limitRpm);
    if (limit === undefined) {
      return { limited: false };
    }

    const redisKey = `mcp:rate:${params.tokenId}:${params.toolId}`;
    if (this.redis === undefined) {
      this.auditRedisUnavailable(params, 'Redis client is not configured');
      return { limited: false };
    }

    const now = Date.now();
    try {
      await this.redis.zadd(redisKey, now, `${now}:${randomUUID()}`);
      await this.redis.zremrangebyscore(redisKey, 0, now - WINDOW_MS);
      const count = Number(await this.redis.zcard(redisKey));
      await this.redis.expire(redisKey, WINDOW_SECONDS);

      if (!Number.isFinite(count)) {
        throw new Error('Invalid Redis ZCARD result');
      }

      if (count > limit) {
        return {
          limited: true,
          retryAfter: WINDOW_SECONDS,
        };
      }

      return { limited: false };
    } catch (err) {
      getApiLogger().warn({ err, redis_key: redisKey }, 'MCP rate limit check failed');
      this.auditRedisUnavailable(params, err instanceof Error ? err.message : String(err));
      return { limited: false };
    }
  }

  private auditRedisUnavailable(params: McpRateLimitParams, reason: string): void {
    this.auditService.push({
      tenant_id: params.tenantId,
      actor_user_id: params.actorUserId,
      action: 'mcp.rate_limit.redis_unavailable',
      resource_type: 'mcp_tool',
      resource_id: params.toolId,
      space_id: params.spaceId,
      ...toAuditFields(params.audit),
      metadata_json: {
        tool_name: params.toolName,
        caller_token_id: params.tokenId,
        rate_limit_rpm: params.limitRpm ?? null,
        reason,
      },
    });
  }
}

function normalizeLimit(limitRpm: number | undefined): number | undefined {
  if (limitRpm === undefined || !Number.isInteger(limitRpm) || limitRpm <= 0) {
    return undefined;
  }

  return limitRpm;
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
