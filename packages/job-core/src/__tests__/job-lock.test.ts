import { describe, expect, it } from 'vitest';

import { RedisJobLock } from '../lock.js';
import { RedisMock } from './test-utils.js';

describe('RedisJobLock', () => {
  it('acquires a lock for an empty key', async () => {
    const redis = new RedisMock();

    await expect(RedisJobLock.acquire(redis, 'job-1', 'worker-1')).resolves.toBe(true);
    await expect(redis.get(RedisJobLock.key('job-1'))).resolves.toBe('worker-1');
  });

  it('fails to acquire a lock held by another worker', async () => {
    const redis = new RedisMock();
    redis.seed(RedisJobLock.key('job-1'), 'worker-2');

    await expect(RedisJobLock.acquire(redis, 'job-1', 'worker-1')).resolves.toBe(false);
  });

  it('renews a lock for the owner', async () => {
    const redis = new RedisMock();
    redis.seed(RedisJobLock.key('job-1'), 'worker-1');

    await expect(RedisJobLock.renew(redis, 'job-1', 'worker-1')).resolves.toBe(true);
    await expect(redis.get(RedisJobLock.key('job-1'))).resolves.toBe('worker-1');
  });

  it('fails to renew a lock for a non-owner', async () => {
    const redis = new RedisMock();
    redis.seed(RedisJobLock.key('job-1'), 'worker-2');

    await expect(RedisJobLock.renew(redis, 'job-1', 'worker-1')).resolves.toBe(false);
    await expect(redis.get(RedisJobLock.key('job-1'))).resolves.toBe('worker-2');
  });

  it('releases a lock for the owner using the Lua script', async () => {
    const redis = new RedisMock();
    redis.seed(RedisJobLock.key('job-1'), 'worker-1');

    await expect(RedisJobLock.release(redis, 'job-1', 'worker-1')).resolves.toBe(true);
    await expect(redis.get(RedisJobLock.key('job-1'))).resolves.toBeNull();
  });

  it('refuses to release a lock for a non-owner', async () => {
    const redis = new RedisMock();
    redis.seed(RedisJobLock.key('job-1'), 'worker-2');

    await expect(RedisJobLock.release(redis, 'job-1', 'worker-1')).resolves.toBe(false);
    await expect(redis.get(RedisJobLock.key('job-1'))).resolves.toBe('worker-2');
  });
});
