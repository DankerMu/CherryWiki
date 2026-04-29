import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@cherrygraph/shared';
import { randomUUID } from 'node:crypto';

import { getApiLogger } from '../logger/logger.module.js';
import { getRequestContext } from '../middleware/request-context.middleware.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

export type RateLimitMode = 'user' | 'ip';

export type RateLimitOptions = {
  limit: number;
  windowSec: number;
  mode: RateLimitMode;
};

export type RateLimitRedisStore = {
  eval: (script: string, numberOfKeys: number, ...args: Array<string | number>) => Promise<unknown>;
};

export const RATE_LIMIT_METADATA_KEY = Symbol('RATE_LIMIT_METADATA_KEY');
export const PUBLIC_API_RATE_LIMIT: RateLimitOptions = { limit: 600, windowSec: 60, mode: 'user' };
export const ADMIN_API_RATE_LIMIT: RateLimitOptions = { limit: 300, windowSec: 60, mode: 'user' };
export const LOGIN_RATE_LIMIT: RateLimitOptions = { limit: 10, windowSec: 60, mode: 'ip' };

const RATE_LIMIT_SCRIPT = `
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

type RequestLike = {
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
  raw?: {
    ip?: string;
  };
  user?: unknown;
};

type ResponseLike = {
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
  raw?: {
    setHeader?: (name: string, value: string) => unknown;
  };
};

export function RateLimit(limit: number, windowSec: number, mode: RateLimitMode): MethodDecorator & ClassDecorator {
  return SetMetadata(RATE_LIMIT_METADATA_KEY, { limit, windowSec, mode } satisfies RateLimitOptions);
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: RateLimitRedisStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (options === undefined || this.redis === undefined) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestLike>();
    const response = context.switchToHttp().getResponse<ResponseLike>();
    const identifier = getIdentifier(request, options.mode);
    const now = Date.now();
    const windowMs = options.windowSec * 1000;
    const tenantId = getRequestContext()?.tenant_id ?? '';
    const redisKey = `ratelimit:${tenantId}:${options.mode}:${identifier}:${options.windowSec}:${options.limit}`;
    const resetAt = Math.ceil((now + windowMs) / 1000);

    try {
      const result = parseRateLimitResult(
        await this.redis.eval(
          RATE_LIMIT_SCRIPT,
          1,
          redisKey,
          now,
          windowMs,
          options.limit,
          `${now}:${randomUUID()}`,
          options.windowSec,
        ),
      );

      if (!result.allowed) {
        setRateLimitHeaders(response, options.limit, 0, resetAt);
        throw new HttpException(
          {
            code: ErrorCode.RATE_LIMITED,
            message: 'Rate limit exceeded',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      setRateLimitHeaders(response, options.limit, options.limit - result.count, resetAt);
      return true;
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }

      getApiLogger().warn({ err, redis_key: redisKey }, 'Rate limit check failed');
      return true;
    }
  }
}

function getIdentifier(request: RequestLike, mode: RateLimitMode): string {
  if (mode === 'user') {
    return getUserIdentifier(request) ?? getIpIdentifier(request);
  }

  return getIpIdentifier(request);
}

function getUserIdentifier(request: RequestLike): string | undefined {
  const contextUserId = getRequestContext()?.user_id;
  if (contextUserId !== null && contextUserId !== undefined && contextUserId.length > 0) {
    return contextUserId;
  }

  if (!isRecord(request.user)) {
    return undefined;
  }

  for (const key of ['user_id', 'id', 'sub']) {
    const value = request.user[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function getIpIdentifier(request: RequestLike): string {
  return request.ip || request.raw?.ip || request.socket?.remoteAddress || 'unknown';
}

type RateLimitResult = {
  allowed: boolean;
  count: number;
};

function parseRateLimitResult(result: unknown): RateLimitResult {
  if (!Array.isArray(result) || result.length < 2) {
    throw new Error('Invalid rate limit Redis result');
  }

  const allowedValue = Number(result[0]);
  const count = Number(result[1]);
  if ((allowedValue !== 0 && allowedValue !== 1) || !Number.isFinite(count)) {
    throw new Error('Invalid rate limit Redis result');
  }

  return {
    allowed: allowedValue === 1,
    count,
  };
}

function setRateLimitHeaders(response: ResponseLike, limit: number, remaining: number, resetAt: number): void {
  setResponseHeader(response, 'X-RateLimit-Limit', String(limit));
  setResponseHeader(response, 'X-RateLimit-Remaining', String(Math.max(remaining, 0)));
  setResponseHeader(response, 'X-RateLimit-Reset', String(resetAt));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
