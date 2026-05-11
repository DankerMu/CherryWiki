import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminHealthController } from '../admin-health.controller.js';
import type { AdminSystemHealthResponse, HealthComponent } from '../admin-health.controller.js';
import type { StorageService } from '../../storage/storage.service.js';

type DbQuery = ReturnType<typeof vi.fn<(queryText: string) => Promise<unknown>>>;
type RedisPing = ReturnType<typeof vi.fn<() => Promise<unknown>>>;
type StorageConfigured = ReturnType<typeof vi.fn<() => boolean>>;
type StorageHealthCheck = ReturnType<typeof vi.fn<() => Promise<HealthComponent>>>;

describe('AdminHealthController', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns healthy when configured components are healthy', async () => {
    const { controller, dbQuery, redisPing, storageHealthCheck } = createController();

    const result = await getHealthWithDocmostUnset(controller);

    expect(result.status).toBe('healthy');
    expect(result.components.database.status).toBe('healthy');
    expect(result.components.redis.status).toBe('healthy');
    expect(result.components.minio).toEqual({ status: 'healthy', latency_ms: 12 });
    expect(result.components.vector_store).toEqual({
      status: 'healthy',
      latency_ms: result.components.database.latency_ms,
      details: expect.stringMatching(/Postgres/i) as unknown,
    });
    expect(result.components.graph_store).toEqual({
      status: 'healthy',
      latency_ms: result.components.database.latency_ms,
      details: expect.stringMatching(/Postgres/i) as unknown,
    });
    expect(result.components.docmost_bridge).toEqual({
      status: 'not_configured',
      details: 'DOCMOST_BASE_URL not set',
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

    const result = await getHealthWithDocmostUnset(controller);

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

    const result = await getHealthWithDocmostUnset(controller);

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

    const result = await getHealthWithDocmostUnset(controller);

    expect(result.status).toBe('unhealthy');
    expect(result.components.vector_store).toEqual({
      status: 'unhealthy',
      error: expect.stringMatching(/database/i) as unknown,
      details: expect.stringMatching(/Postgres/i) as unknown,
    });
    expect(result.components.graph_store).toEqual({
      status: 'unhealthy',
      error: expect.stringMatching(/database/i) as unknown,
      details: expect.stringMatching(/Postgres/i) as unknown,
    });
  });

  it('marks undeployed or absent components as not_configured', async () => {
    const { controller } = createController({ redisPing: undefined, storageConfigured: vi.fn(() => false) });

    const result = await getHealthWithDocmostUnset(controller);

    expect(result.status).toBe('healthy');
    expect(result.components.redis).toEqual({ status: 'not_configured' });
    expect(result.components.minio).toEqual({ status: 'not_configured' });
    expect(result.components.vector_store).toEqual({
      status: 'healthy',
      latency_ms: result.components.database.latency_ms,
      details: expect.stringMatching(/Postgres/i) as unknown,
    });
    expect(result.components.graph_store).toEqual({
      status: 'healthy',
      latency_ms: result.components.database.latency_ms,
      details: expect.stringMatching(/Postgres/i) as unknown,
    });
    expect(result.components.docmost_bridge).toEqual({
      status: 'not_configured',
      details: 'DOCMOST_BASE_URL not set',
    });
  });

  it('keeps the optional docmost bridge neutral when it is not configured', async () => {
    const { controller } = createController();

    const result = await getHealthWithDocmostUnset(controller);

    expect(result.status).toBe('healthy');
    expect(result.components.docmost_bridge).toEqual({
      status: 'not_configured',
      details: 'DOCMOST_BASE_URL not set',
    });
  });

  it('reports Docmost healthy when the health endpoint returns 200', async () => {
    const { controller } = createController();
    const fetchMock = mockFetchResponse(200);

    const result = await withEnv('DOCMOST_BASE_URL', 'https://docmost.example.com/', () => controller.getHealth());

    expect(result.status).toBe('healthy');
    expect(result.components.docmost_bridge).toEqual({
      status: 'healthy',
      latency_ms: expect.any(Number) as unknown,
    });
    expect(result.components.docmost_bridge.latency_ms).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith('https://docmost.example.com/api/health', {
      method: 'GET',
      signal: expect.any(AbortSignal) as unknown,
    });
  });

  it('reports Docmost unhealthy when the health endpoint is unreachable', async () => {
    const { controller } = createController();
    mockFetchError(new TypeError('network error'));

    const result = await withEnv('DOCMOST_BASE_URL', 'https://docmost.example.com', () => controller.getHealth());

    expect(result.status).toBe('degraded');
    expect(result.components.docmost_bridge).toEqual(
      expect.objectContaining({
        status: 'unhealthy',
        error: 'network error',
      }),
    );
  });

  it('reports Docmost not_configured when DOCMOST_BASE_URL is unset', async () => {
    const { controller } = createController();
    const fetchMock = mockFetchResponse(200);

    const result = await getHealthWithDocmostUnset(controller);

    expect(result.status).toBe('healthy');
    expect(result.components.docmost_bridge).toEqual({
      status: 'not_configured',
      details: 'DOCMOST_BASE_URL not set',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports Docmost unhealthy when the health check times out', async () => {
    vi.useFakeTimers();
    const { controller } = createController();
    const fetchMock = mockFetchTimeout();

    await withEnv('DOCMOST_BASE_URL', 'https://docmost.example.com', async () => {
      const resultPromise = controller.getHealth();

      await vi.advanceTimersByTimeAsync(5000);
      const result = await resultPromise;

      expect(result.status).toBe('degraded');
      expect(result.components.docmost_bridge).toEqual({
        status: 'unhealthy',
        latency_ms: 5000,
        error: 'Health check timed out (5s)',
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns degraded overall when Docmost is unhealthy and database is healthy', async () => {
    const { controller } = createController();
    mockFetchError(new TypeError('docmost down'));

    const result = await withEnv('DOCMOST_BASE_URL', 'https://docmost.example.com', () => controller.getHealth());

    expect(result.components.database.status).toBe('healthy');
    expect(result.components.docmost_bridge.status).toBe('unhealthy');
    expect(result.status).toBe('degraded');
  });

  it('returns healthy overall when Docmost is not configured and database is healthy', async () => {
    const { controller } = createController();

    const result = await getHealthWithDocmostUnset(controller);

    expect(result.components.database.status).toBe('healthy');
    expect(result.components.docmost_bridge.status).toBe('not_configured');
    expect(result.status).toBe('healthy');
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

function mockFetchResponse(status: number) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    status,
    body: {
      cancel: vi.fn(() => Promise.resolve(undefined)),
    },
  } as unknown as Response);
}

function mockFetchError(error: Error) {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(error);
}

function mockFetchTimeout() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      }),
  );
}

async function getHealthWithDocmostUnset(controller: AdminHealthController): Promise<AdminSystemHealthResponse> {
  return withEnv('DOCMOST_BASE_URL', undefined, () => controller.getHealth());
}

async function withEnv<T>(name: string, value: string | undefined, callback: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}
