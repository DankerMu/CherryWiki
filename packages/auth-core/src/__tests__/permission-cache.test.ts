import { describe, expect, it } from 'vitest';

import { PermissionCache, type PermissionCacheKey, type PermissionCacheRedis } from '../permission-cache.js';
import { PermissionSubscriber } from '../permission-subscriber.js';

describe('PermissionCache', () => {
  it('returns null on cache miss', async () => {
    const cache = new PermissionCache(new MapPermissionRedis());

    await expect(cache.getPermissions(createKey())).resolves.toBeNull();
  });

  it('returns cached permissions after set', async () => {
    const cache = new PermissionCache(new MapPermissionRedis());
    const key = createKey();

    await cache.setPermissions(key, ['space:view', 'space:edit']);

    await expect(cache.getPermissions(key)).resolves.toEqual(['space:view', 'space:edit']);
  });

  it('invalidates cached user permissions', async () => {
    const redis = new MapPermissionRedis();
    const cache = new PermissionCache(redis);
    const userKey = createKey();
    const otherUserKey = createKey({ user_id: 'user-2' });

    await cache.setPermissions(userKey, ['space:view']);
    await cache.setPermissions(otherUserKey, ['space:view']);
    await cache.invalidateUserPermissions('tenant-1', 'user-1');

    await expect(cache.getPermissions(userKey)).resolves.toBeNull();
    await expect(cache.getPermissions(otherUserKey)).resolves.toEqual(['space:view']);
  });

  it('invalidates cached space permissions from pub/sub messages', async () => {
    const redis = new MapPermissionRedis();
    const cache = new PermissionCache(redis);
    const subscriber = new PermissionSubscriber(cache);
    const key = createKey();

    await cache.setPermissions(key, ['space:view']);
    await subscriber.handleMessage('permission_changed:space-1', JSON.stringify({ tenant_id: 'tenant-1' }));

    await expect(cache.getPermissions(key)).resolves.toBeNull();
  });
});

class MapPermissionRedis implements PermissionCacheRedis {
  readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown> {
    expect(mode).toBe('EX');
    expect(ttlSeconds).toBeGreaterThan(0);
    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.values.delete(key)) {
        count += 1;
      }
    }

    return Promise.resolve(count);
  }

  scan(cursor: string, ...args: string[]): Promise<[string, string[]]> {
    expect(cursor).toBe('0');
    const pattern = getScanPattern(args);
    const matcher = globToRegExp(pattern);
    const keys = [...this.values.keys()].filter((key) => matcher.test(key));

    return Promise.resolve(['0', keys]);
  }
}

function createKey(overrides: Partial<PermissionCacheKey> = {}): PermissionCacheKey {
  return {
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    user_pv: 1,
    space_id: 'space-1',
    space_pv: 1,
    hash: 'query-hash',
    ...overrides,
  };
}

function getScanPattern(args: string[]): string {
  const matchIndex = args.indexOf('MATCH');
  const pattern = matchIndex === -1 ? undefined : args[matchIndex + 1];
  return pattern ?? '*';
}

function globToRegExp(pattern: string): RegExp {
  return new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
