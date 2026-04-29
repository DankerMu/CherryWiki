import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@cherrygraph/shared';
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RATE_LIMIT_METADATA_KEY,
  RateLimitGuard,
  type RateLimitOptions,
  type RateLimitRedisStore,
} from '../rate-limit.guard.js';

class MapRateLimitRedisStore implements RateLimitRedisStore {
  readonly values = new Map<string, Array<{ score: number; member: string }>>();
  readonly expirations = new Map<string, number>();

  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<[number, number]> {
    expect(script).toContain('ZREMRANGEBYSCORE');
    expect(numberOfKeys).toBe(1);

    const [key, nowValue, windowMsValue, limitValue, memberValue, ttlValue] = args;
    if (typeof key !== 'string' || typeof memberValue !== 'string') {
      return Promise.reject(new Error('Invalid eval arguments'));
    }

    const now = Number(nowValue);
    const windowMs = Number(windowMsValue);
    const limit = Number(limitValue);
    const ttl = Number(ttlValue);
    const entries = this.values.get(key) ?? [];
    const kept = entries.filter((entry) => entry.score < 0 || entry.score > now - windowMs);
    this.values.set(key, kept);

    if (kept.length >= limit) {
      return Promise.resolve([0, kept.length]);
    }

    kept.push({ score: now, member: memberValue });
    this.expirations.set(key, ttl);
    return Promise.resolve([1, kept.length]);
  }
}

type FakeResponse = {
  headers: Map<string, string>;
  header: (name: string, value: string) => FakeResponse;
};

describe('RateLimitGuard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows normal requests and sets rate limit headers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const redis = new MapRateLimitRedisStore();
    const guard = new RateLimitGuard(new Reflector(), redis);
    const response = createResponse();

    await expect(guard.canActivate(createContext({ limit: 2, windowSec: 60, mode: 'ip' }, response))).resolves.toBe(
      true,
    );

    expect(response.headers.get('x-ratelimit-limit')).toBe('2');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('1');
    expect(response.headers.get('x-ratelimit-reset')).toBe('60');
  });

  it('throws 429 RATE_LIMITED when the limit is exceeded', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const redis = new MapRateLimitRedisStore();
    const guard = new RateLimitGuard(new Reflector(), redis);
    const response = createResponse();
    const context = createContext({ limit: 1, windowSec: 60, mode: 'ip' }, response);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 429 });

    try {
      await guard.canActivate(context);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const responseBody = (err as HttpException).getResponse();
      expect(isRecord(responseBody) ? responseBody.code : undefined).toBe(ErrorCode.RATE_LIMITED);
    }
  });

  it('tracks different user identifiers independently', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const redis = new MapRateLimitRedisStore();
    const guard = new RateLimitGuard(new Reflector(), redis);

    await expect(
      guard.canActivate(createContext({ limit: 1, windowSec: 60, mode: 'user' }, createResponse(), 'user-a')),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(createContext({ limit: 1, windowSec: 60, mode: 'user' }, createResponse(), 'user-a')),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      guard.canActivate(createContext({ limit: 1, windowSec: 60, mode: 'user' }, createResponse(), 'user-b')),
    ).resolves.toBe(true);
  });

  it('allows requests again after the sliding window resets', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const redis = new MapRateLimitRedisStore();
    const guard = new RateLimitGuard(new Reflector(), redis);
    const options: RateLimitOptions = { limit: 1, windowSec: 60, mode: 'ip' };

    await expect(guard.canActivate(createContext(options, createResponse()))).resolves.toBe(true);
    await expect(guard.canActivate(createContext(options, createResponse()))).rejects.toMatchObject({ status: 429 });

    vi.setSystemTime(61_000);
    await expect(guard.canActivate(createContext(options, createResponse()))).resolves.toBe(true);
  });

  it('uses request.ip instead of trusting x-forwarded-for directly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const redis = new MapRateLimitRedisStore();
    const guard = new RateLimitGuard(new Reflector(), redis);

    await expect(
      guard.canActivate(
        createContext({ limit: 2, windowSec: 60, mode: 'ip' }, createResponse(), undefined, {
          headers: { 'x-forwarded-for': '198.51.100.200' },
          ip: '203.0.113.10',
        }),
      ),
    ).resolves.toBe(true);

    expect(redis.values.has('ratelimit::ip:203.0.113.10:60:2')).toBe(true);
    expect(redis.values.has('ratelimit::ip:198.51.100.200:60:2')).toBe(false);
  });
});

type RequestOverrides = {
  headers?: Record<string, string>;
  ip?: string;
};

function createContext(
  options: RateLimitOptions,
  response: FakeResponse,
  userId?: string,
  requestOverrides: RequestOverrides = {},
): ExecutionContext {
  const handler = () => undefined;
  Reflect.defineMetadata(RATE_LIMIT_METADATA_KEY, options, handler);

  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({
        ip: requestOverrides.ip ?? '203.0.113.10',
        headers: requestOverrides.headers,
        user: userId === undefined ? undefined : { user_id: userId },
      }),
      getResponse: () => response,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function createResponse(): FakeResponse {
  const response: FakeResponse = {
    headers: new Map<string, string>(),
    header(name: string, value: string): FakeResponse {
      response.headers.set(name.toLowerCase(), value);
      return response;
    },
  };

  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
