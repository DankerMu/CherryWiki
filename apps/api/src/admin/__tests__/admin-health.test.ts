import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminHealthController } from '../admin-health.controller.js';
import type { StorageService } from '../../storage/storage.service.js';

type DbQuery = ReturnType<typeof vi.fn<(queryText: string) => Promise<unknown>>>;
type RedisPing = ReturnType<typeof vi.fn<() => Promise<unknown>>>;
type StorageConfigured = ReturnType<typeof vi.fn<() => boolean>>;
type StorageHealthCheck = ReturnType<
  typeof vi.fn<() => Promise<{ status: 'healthy' | 'unhealthy'; latency_ms: number; error?: string }>>
>;

describe('AdminHealthController', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns healthy when configured components are healthy', async () => {
    const { controller, dbQuery, redisPing, storageHealthCheck } = createController();

    const result = await controller.getHealth();

    expect(result.status).toBe('healthy');
    expect(result.components.database.status).toBe('healthy');
    expect(result.components.redis.status).toBe('healthy');
    expect(result.components.minio).toEqual({ status: 'healthy', latency_ms: 12 });
    expect(result.components.vector_store.status).toBe('not_configured');
    expect(result.components.graph_store.status).toBe('not_configured');
    expect(result.components.docmost_bridge.status).toBe('not_configured');
    expect(result.uptime).toBeGreaterThanOrEqual(1);
    expect(dbQuery).toHaveBeenCalledWith('select 1');
    expect(redisPing).toHaveBeenCalledTimes(1);
    expect(storageHealthCheck).toHaveBeenCalledTimes(1);
  });

  it('returns degraded when Redis is configured but unavailable', async () => {
    const { controller } = createController({
      redisPing: vi.fn<() => Promise<unknown>>(() => Promise.reject(new Error('redis down'))),
    });

    const result = await controller.getHealth();

    expect(result.status).toBe('degraded');
    expect(result.components.database.status).toBe('healthy');
    expect(result.components.redis).toEqual(
      expect.objectContaining({
        status: 'unhealthy',
        error: 'redis down',
      }),
    );
  });

  it('returns unhealthy when the database is unavailable', async () => {
    const { controller } = createController({
      dbQuery: vi.fn<(queryText: string) => Promise<unknown>>(() => Promise.reject(new Error('db down'))),
    });

    const result = await controller.getHealth();

    expect(result.status).toBe('unhealthy');
    expect(result.components.database).toEqual(
      expect.objectContaining({
        status: 'unhealthy',
        error: 'db down',
      }),
    );
  });

  it('marks undeployed or absent components as not_configured', async () => {
    const { controller } = createController({ redisPing: undefined, storageConfigured: vi.fn(() => false) });

    const result = await controller.getHealth();

    expect(result.status).toBe('healthy');
    expect(result.components.redis).toEqual({ status: 'not_configured' });
    expect(result.components.minio).toEqual({ status: 'not_configured' });
    expect(result.components.vector_store).toEqual({ status: 'not_configured' });
    expect(result.components.graph_store).toEqual({ status: 'not_configured' });
    expect(result.components.docmost_bridge).toEqual({ status: 'not_configured' });
  });
});

function createController(
  overrides: Partial<{
    dbQuery: DbQuery;
    redisPing: RedisPing | undefined;
    storageConfigured: StorageConfigured;
    storageHealthCheck: StorageHealthCheck;
  }> = {},
): {
  controller: AdminHealthController;
  dbQuery: DbQuery;
  redisPing: RedisPing | undefined;
  storageConfigured: StorageConfigured;
  storageHealthCheck: StorageHealthCheck;
} {
  const dbQuery =
    overrides.dbQuery ?? vi.fn<(queryText: string) => Promise<unknown>>(() => Promise.resolve({ rows: [{ '?column?': 1 }] }));
  const redisPing =
    Object.hasOwn(overrides, 'redisPing') ? overrides.redisPing : vi.fn<() => Promise<unknown>>(() => Promise.resolve('PONG'));
  const storageConfigured = overrides.storageConfigured ?? vi.fn(() => true);
  const storageHealthCheck =
    overrides.storageHealthCheck ?? vi.fn<() => Promise<{ status: 'healthy'; latency_ms: number }>>(() =>
      Promise.resolve({ status: 'healthy', latency_ms: 12 }),
    );
  const db = {
    $client: {
      query: dbQuery,
    },
  };
  const redis = redisPing === undefined ? undefined : { ping: redisPing };
  const storage = {
    isConfigured: storageConfigured,
    healthCheck: storageHealthCheck,
  };

  return {
    controller: new AdminHealthController(db, redis, storage as unknown as StorageService),
    dbQuery,
    redisPing,
    storageConfigured,
    storageHealthCheck,
  };
}
