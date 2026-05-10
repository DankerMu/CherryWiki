import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminHealthController } from '../admin-health.controller.js';
import type { HealthComponent } from '../admin-health.controller.js';
import type { StorageService } from '../../storage/storage.service.js';

type DbQuery = ReturnType<typeof vi.fn<(queryText: string) => Promise<unknown>>>;
type RedisPing = ReturnType<typeof vi.fn<() => Promise<unknown>>>;
type StorageConfigured = ReturnType<typeof vi.fn<() => boolean>>;
type StorageHealthCheck = ReturnType<typeof vi.fn<() => Promise<HealthComponent>>>;

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
    expect(result.components.vector_store).toEqual({
      status: 'healthy',
      latency_ms: result.components.database.latency_ms,
      details: expect.stringMatching(/Postgres/i),
    });
    expect(result.components.graph_store).toEqual({
      status: 'healthy',
      latency_ms: result.components.database.latency_ms,
      details: expect.stringMatching(/Postgres/i),
    });
    expect(result.components.docmost_bridge).toEqual({
      status: 'not_configured',
      details: expect.stringMatching(/optional/i),
    });
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

  it('marks Postgres-backed stores unhealthy when the database is unavailable', async () => {
    const { controller } = createController({
      dbQuery: vi.fn<(queryText: string) => Promise<unknown>>(() => Promise.reject(new Error('db down'))),
    });

    const result = await controller.getHealth();

    expect(result.status).toBe('unhealthy');
    expect(result.components.vector_store).toEqual({
      status: 'unhealthy',
      error: expect.stringMatching(/database/i),
      details: expect.stringMatching(/Postgres/i),
    });
    expect(result.components.graph_store).toEqual({
      status: 'unhealthy',
      error: expect.stringMatching(/database/i),
      details: expect.stringMatching(/Postgres/i),
    });
  });

  it('marks undeployed or absent components as not_configured', async () => {
    const { controller } = createController({ redisPing: undefined, storageConfigured: vi.fn(() => false) });

    const result = await controller.getHealth();

    expect(result.status).toBe('healthy');
    expect(result.components.redis).toEqual({ status: 'not_configured' });
    expect(result.components.minio).toEqual({ status: 'not_configured' });
    expect(result.components.vector_store).toEqual({
      status: 'healthy',
      latency_ms: result.components.database.latency_ms,
      details: expect.stringMatching(/Postgres/i),
    });
    expect(result.components.graph_store).toEqual({
      status: 'healthy',
      latency_ms: result.components.database.latency_ms,
      details: expect.stringMatching(/Postgres/i),
    });
    expect(result.components.docmost_bridge).toEqual({
      status: 'not_configured',
      details: expect.stringMatching(/optional/i),
    });
  });

  it('keeps the optional docmost bridge neutral when it is not configured', async () => {
    const { controller } = createController();

    const result = await controller.getHealth();

    expect(result.status).toBe('healthy');
    expect(result.components.docmost_bridge).toEqual({
      status: 'not_configured',
      details: expect.stringMatching(/optional/i),
    });
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
