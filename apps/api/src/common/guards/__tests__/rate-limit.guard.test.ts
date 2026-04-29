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

  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    const minScore = Number(min);
    const maxScore = Number(max);
    const entries = this.values.get(key) ?? [];
    const kept = entries.filter((entry) => entry.score < minScore || entry.score > maxScore);
    this.values.set(key, kept);
    return Promise.resolve(entries.length - kept.length);
  }

  zcard(key: string): Promise<number> {
    return Promise.resolve(this.values.get(key)?.length ?? 0);
  }

  zadd(key: string, score: number, member: string): Promise<number> {
    const entries = this.values.get(key) ?? [];
    entries.push({ score, member });
    this.values.set(key, entries);
    return Promise.resolve(1);
  }

  expire(key: string, seconds: number): Promise<number> {
    this.expirations.set(key, seconds);
    return Promise.resolve(1);
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
});

function createContext(options: RateLimitOptions, response: FakeResponse, userId?: string): ExecutionContext {
  const handler = () => undefined;
  Reflect.defineMetadata(RATE_LIMIT_METADATA_KEY, options, handler);

  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({
        ip: '203.0.113.10',
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
