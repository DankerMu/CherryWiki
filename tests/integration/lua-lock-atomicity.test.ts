import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedisJobLock } from '@cherrygraph/job-core';

import { ExpiringRedisMock } from './stage2-integration-test-utils.js';

describe('Stage 2 Lua lock atomicity integration', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows only the owner to release a Redis lock', async () => {
    const redis = new ExpiringRedisMock();
    redis.seed(RedisJobLock.key('job-1'), 'worker-1', 600);

    await expect(RedisJobLock.release(redis, 'job-1', 'worker-1')).resolves.toBe(true);
    expect(redis.has(RedisJobLock.key('job-1'))).toBe(false);

    redis.seed(RedisJobLock.key('job-1'), 'worker-2', 600);
    await expect(RedisJobLock.release(redis, 'job-1', 'worker-1')).resolves.toBe(false);
    await expect(redis.get(RedisJobLock.key('job-1'))).resolves.toBe('worker-2');
  });

  it('allows only the owner to renew a Redis lock and resets TTL atomically', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    const redis = new ExpiringRedisMock();
    redis.seed(RedisJobLock.key('job-1'), 'worker-1', 1);

    await expect(RedisJobLock.renew(redis, 'job-1', 'worker-1', 5)).resolves.toBe(true);
    vi.advanceTimersByTime(1_500);
    expect(redis.has(RedisJobLock.key('job-1'))).toBe(true);

    redis.seed(RedisJobLock.key('job-2'), 'worker-2', 600);
    await expect(RedisJobLock.renew(redis, 'job-2', 'worker-1', 5)).resolves.toBe(false);
    await expect(redis.get(RedisJobLock.key('job-2'))).resolves.toBe('worker-2');
  });
});
