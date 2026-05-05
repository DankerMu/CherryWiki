import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';
import { randomUUID } from 'node:crypto';

import { getApiLogger } from '../common/logger/logger.module.js';
import { REDIS_CLIENT } from '../common/redis/redis.module.js';

type BridgeRateLimitRedisStore = {
  eval: (script: string, numberOfKeys: number, ...args: Array<string | number>) => Promise<unknown>;
};

type RequestLike = {
  body?: unknown;
  ip?: string;
  raw?: {
    ip?: string;
    socket?: {
      remoteAddress?: string;
    };
  };
  socket?: {
    remoteAddress?: string;
  };
  headers?: Record<string, string | string[] | undefined>;
};

type ResponseLike = {
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
  raw?: {
    setHeader?: (name: string, value: string) => unknown;
  };
};

type BridgeRateLimitCheck = {
  dimension: 'global' | 'ip' | 'space';
  key: string;
  limit: number;
  windowSec: number;
  identifier: string;
};

const BRIDGE_RATE_LIMIT_WINDOW_SECONDS = 60;
const BRIDGE_GLOBAL_LIMIT = 1_000;
const BRIDGE_IP_LIMIT = 100;
const BRIDGE_SPACE_LIMIT = 200;

const BRIDGE_RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local ttl_seconds = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', key, 0, now - window_ms)
local count = redis.call('ZCARD', key)
if count >= limit then
  return {0, count}
end

redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl_seconds)
return {1, count + 1}
`;

@Injectable()
export class BridgeRateLimitGuard implements CanActivate {
  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: BridgeRateLimitRedisStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.redis === undefined) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestLike>();
    const response = context.switchToHttp().getResponse<ResponseLike>();
    const checks = getRateLimitChecks(request);
    const now = Date.now();

    try {
      for (const check of checks) {
        const result = parseRateLimitResult(
          await this.redis.eval(
            BRIDGE_RATE_LIMIT_SCRIPT,
            1,
            check.key,
            now,
            check.windowSec * 1000,
            check.limit,
            `${now}:${randomUUID()}`,
            check.windowSec,
          ),
        );

        if (!result.allowed) {
          setRateLimitHeaders(response, check.limit, 0, check.windowSec);
          this.auditRateLimited(request, check);
          throw new HttpException(
            {
              code: ErrorCode.RATE_LIMITED,
              message: 'Bridge rate limit exceeded',
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        setRateLimitHeaders(response, check.limit, check.limit - result.count, check.windowSec);
      }

      return true;
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }

      getApiLogger().warn({ err }, 'Bridge rate limit check failed');
      return true;
    }
  }

  private auditRateLimited(request: RequestLike, check: BridgeRateLimitCheck): void {
    getApiLogger().warn({
      action: 'bridge.rate_limited',
      dimension: check.dimension,
      identifier: check.identifier,
      ip: getIpAddress(request),
      space_id: getSpaceId(request.body),
      limit: check.limit,
      window_sec: check.windowSec,
    }, 'bridge audit: bridge.rate_limited');
  }
}

function getRateLimitChecks(request: RequestLike): BridgeRateLimitCheck[] {
  const ip = getIpAddress(request);
  const spaceId = getSpaceId(request.body) ?? 'none';

  return [
    {
      dimension: 'global',
      key: `bridge:ratelimit:global:${BRIDGE_RATE_LIMIT_WINDOW_SECONDS}:${BRIDGE_GLOBAL_LIMIT}`,
      identifier: 'global',
      limit: BRIDGE_GLOBAL_LIMIT,
      windowSec: BRIDGE_RATE_LIMIT_WINDOW_SECONDS,
    },
    {
      dimension: 'ip',
      key: `bridge:ratelimit:ip:${ip}:${BRIDGE_RATE_LIMIT_WINDOW_SECONDS}:${BRIDGE_IP_LIMIT}`,
      identifier: ip,
      limit: BRIDGE_IP_LIMIT,
      windowSec: BRIDGE_RATE_LIMIT_WINDOW_SECONDS,
    },
    {
      dimension: 'space',
      key: `bridge:ratelimit:space:${spaceId}:${BRIDGE_RATE_LIMIT_WINDOW_SECONDS}:${BRIDGE_SPACE_LIMIT}`,
      identifier: spaceId,
      limit: BRIDGE_SPACE_LIMIT,
      windowSec: BRIDGE_RATE_LIMIT_WINDOW_SECONDS,
    },
  ];
}

type RateLimitResult = {
  allowed: boolean;
  count: number;
};

function parseRateLimitResult(result: unknown): RateLimitResult {
  if (!Array.isArray(result) || result.length < 2) {
    throw new Error('Invalid Bridge rate limit Redis result');
  }

  const allowedValue = Number(result[0]);
  const count = Number(result[1]);
  if ((allowedValue !== 0 && allowedValue !== 1) || !Number.isFinite(count)) {
    throw new Error('Invalid Bridge rate limit Redis result');
  }

  return {
    allowed: allowedValue === 1,
    count,
  };
}

function getSpaceId(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  const value = body.space_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function setRateLimitHeaders(response: ResponseLike, limit: number, remaining: number, retryAfterSeconds: number): void {
  setResponseHeader(response, 'X-RateLimit-Limit', String(limit));
  setResponseHeader(response, 'X-RateLimit-Remaining', String(Math.max(remaining, 0)));
  setResponseHeader(response, 'Retry-After', String(retryAfterSeconds));
}

function setResponseHeader(response: ResponseLike, name: string, value: string): void {
  if (typeof response.header === 'function') {
    response.header(name, value);
    return;
  }

  if (typeof response.setHeader === 'function') {
    response.setHeader(name, value);
    return;
  }

  response.raw?.setHeader?.(name, value);
}

function getIpAddress(request: RequestLike): string {
  return request.ip || request.raw?.ip || request.raw?.socket?.remoteAddress || request.socket?.remoteAddress || 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
