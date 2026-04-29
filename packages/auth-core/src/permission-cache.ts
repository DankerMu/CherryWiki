export type PermissionCacheKey = {
  tenant_id: string;
  user_id: string;
  user_pv: string | number;
  space_id: string;
  space_pv: string | number;
  hash: string;
};

export type PermissionCacheRedis = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, mode: 'EX', ttlSeconds: number) => Promise<unknown>;
  del: (...keys: string[]) => Promise<number>;
  scan: (cursor: string, ...args: string[]) => Promise<[string, string[]]>;
};

export const DEFAULT_PERMISSION_CACHE_TTL_SECONDS = 60;
export const MAX_PERMISSION_CACHE_TTL_SECONDS = 300;

export class PermissionCache {
  constructor(private readonly redis?: PermissionCacheRedis) {}

  async getPermissions(key: PermissionCacheKey): Promise<string[] | null> {
    if (this.redis === undefined) {
      return null;
    }

    const value = await this.redis.get(buildPermissionCacheKey(key));
    if (value === null) {
      return null;
    }

    return parsePermissions(value);
  }

  async setPermissions(
    key: PermissionCacheKey,
    permissions: readonly string[],
    ttl = DEFAULT_PERMISSION_CACHE_TTL_SECONDS,
  ): Promise<void> {
    if (this.redis === undefined) {
      return;
    }

    const ttlSeconds = Math.min(Math.max(Math.trunc(ttl), 1), MAX_PERMISSION_CACHE_TTL_SECONDS);
    await this.redis.set(buildPermissionCacheKey(key), JSON.stringify([...permissions]), 'EX', ttlSeconds);
  }

  async invalidateUserPermissions(tenantId: string, userId: string): Promise<void> {
    if (this.redis === undefined) {
      return;
    }

    await deleteByPattern(this.redis, `perm:${tenantId}:${userId}:*`);
  }

  async invalidateSpacePermissions(tenantId: string, spaceId: string): Promise<void> {
    if (this.redis === undefined) {
      return;
    }

    await deleteByPattern(this.redis, `perm:${tenantId}:*:*:${spaceId}:*`);
  }

  async invalidateUserPermissionsAcrossTenants(userId: string): Promise<void> {
    if (this.redis === undefined) {
      return;
    }

    await deleteByPattern(this.redis, `perm:*:${userId}:*`);
  }

  async invalidateSpacePermissionsAcrossTenants(spaceId: string): Promise<void> {
    if (this.redis === undefined) {
      return;
    }

    await deleteByPattern(this.redis, `perm:*:*:*:${spaceId}:*`);
  }
}

let defaultPermissionCache = new PermissionCache();

export function configurePermissionCache(redis?: PermissionCacheRedis): PermissionCache {
  defaultPermissionCache = new PermissionCache(redis);
  return defaultPermissionCache;
}

export function buildPermissionCacheKey(key: PermissionCacheKey): string {
  return `perm:${key.tenant_id}:${key.user_id}:${key.user_pv}:${key.space_id}:${key.space_pv}:${key.hash}`;
}

export async function getPermissions(key: PermissionCacheKey): Promise<string[] | null> {
  return defaultPermissionCache.getPermissions(key);
}

export async function setPermissions(
  key: PermissionCacheKey,
  permissions: readonly string[],
  ttl?: number,
): Promise<void> {
  await defaultPermissionCache.setPermissions(key, permissions, ttl);
}

export async function invalidateUserPermissions(tenantId: string, userId: string): Promise<void> {
  await defaultPermissionCache.invalidateUserPermissions(tenantId, userId);
}

export async function invalidateSpacePermissions(tenantId: string, spaceId: string): Promise<void> {
  await defaultPermissionCache.invalidateSpacePermissions(tenantId, spaceId);
}

function parsePermissions(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((permission) => typeof permission === 'string')) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function deleteByPattern(redis: PermissionCacheRedis, pattern: string): Promise<void> {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
}
