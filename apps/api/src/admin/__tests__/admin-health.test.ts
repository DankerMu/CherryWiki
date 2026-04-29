import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminHealthController } from '../admin-health.controller.js';

type DbQuery = ReturnType<typeof vi.fn<(queryText: string) => Promise<unknown>>>;
type RedisPing = ReturnType<typeof vi.fn<() => Promise<unknown>>>;

const originalMinioEndpoint = process.env.MINIO_ENDPOINT;

describe('AdminHealthController', () => {
  afterEach(() => {
    restoreMinioEndpoint();
    vi.restoreAllMocks();
  });

  it('returns healthy when configured components are healthy', async () => {
    process.env.MINIO_ENDPOINT = 'http://localhost:9000';
    const { controller, dbQuery, redisPing } = createController();

    const result = await controller.getHealth();

    expect(result.status).toBe('healthy');
    expect(result.components.database.status).toBe('healthy');
    expect(result.components.redis.status).toBe('healthy');
    expect(result.components.minio).toEqual({ status: 'healthy', latency_ms: 0 });
    expect(result.components.vector_store.status).toBe('not_configured');
    expect(result.components.graph_store.status).toBe('not_configured');
    expect(result.components.docmost_bridge.status).toBe('not_configured');
    expect(result.uptime).toBeGreaterThanOrEqual(1);
    expect(dbQuery).toHaveBeenCalledWith('select 1');
    expect(redisPing).toHaveBeenCalledTimes(1);
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
    const { controller } = createController({ redisPing: undefined });

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
  }> = {},
): { controller: AdminHealthController; dbQuery: DbQuery; redisPing: RedisPing | undefined } {
  const dbQuery =
    overrides.dbQuery ?? vi.fn<(queryText: string) => Promise<unknown>>(() => Promise.resolve({ rows: [{ '?column?': 1 }] }));
  const redisPing =
    Object.hasOwn(overrides, 'redisPing') ? overrides.redisPing : vi.fn<() => Promise<unknown>>(() => Promise.resolve('PONG'));
  const db = {
    $client: {
      query: dbQuery,
    },
  };
  const redis = redisPing === undefined ? undefined : { ping: redisPing };

  return {
    controller: new AdminHealthController(db, redis),
    dbQuery,
    redisPing,
  };
}

function restoreMinioEndpoint(): void {
  if (originalMinioEndpoint === undefined) {
    delete process.env.MINIO_ENDPOINT;
    return;
  }

  process.env.MINIO_ENDPOINT = originalMinioEndpoint;
}
