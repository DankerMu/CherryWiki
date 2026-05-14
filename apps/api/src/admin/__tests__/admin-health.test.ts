import { lookup as dnsLookup } from 'node:dns/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminHealthController } from '../admin-health.controller.js';
import type { AdminSystemHealthResponse, HealthComponent } from '../admin-health.controller.js';
import type { StorageService } from '../../storage/storage.service.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])),
}));

type DbQuery = ReturnType<typeof vi.fn<(queryText: string) => Promise<unknown>>>;
type RedisPing = ReturnType<typeof vi.fn<() => Promise<unknown>>>;
type StorageConfigured = ReturnType<typeof vi.fn<() => boolean>>;
type StorageHealthCheck = ReturnType<typeof vi.fn<() => Promise<HealthComponent>>>;
const dnsLookupMock = vi.mocked(dnsLookup);

describe('AdminHealthController', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    dnsLookupMock.mockClear();
    setDnsRecords('93.184.216.34');
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
      redirect: 'manual',
      signal: expect.any(AbortSignal) as unknown,
      dispatcher: expect.any(Object) as unknown,
    });
  });

  it('reports Docmost unhealthy for unsupported DOCMOST_BASE_URL scheme before fetching', async () => {
    const { controller } = createController();
    const fetchMock = mockFetchResponse(200);

    const result = await withEnv('DOCMOST_BASE_URL', 'file:///tmp/docmost.sock', () => controller.getHealth());

    expect(result.status).toBe('degraded');
    expect(result.components.docmost_bridge).toEqual(
      expect.objectContaining({
        status: 'unhealthy',
        error: expect.stringMatching(/unsupported URL scheme/i) as unknown,
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dnsLookupMock).not.toHaveBeenCalled();
  });

  it('blocks unsafe Docmost hosts before fetching unless allowlisted', async () => {
    const { controller } = createController();
    const fetchMock = mockFetchResponse(200);

    const result = await withEnv('DOCMOST_BASE_URL', 'http://127.0.0.1:3000', () => controller.getHealth());

    expect(result.status).toBe('degraded');
    expect(result.components.docmost_bridge).toEqual(
      expect.objectContaining({
        status: 'unhealthy',
        error: expect.stringMatching(/blocked private or local address/i) as unknown,
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks Docmost hostnames that resolve to private addresses before fetching', async () => {
    const { controller } = createController();
    const fetchMock = mockFetchResponse(200);
    setDnsRecords('172.16.0.20');

    const result = await withEnv('DOCMOST_BASE_URL', 'https://docmost.internal.example', () => controller.getHealth());

    expect(result.status).toBe('degraded');
    expect(result.components.docmost_bridge).toEqual(
      expect.objectContaining({
        status: 'unhealthy',
        error: expect.stringMatching(/blocked private or local address/i) as unknown,
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows explicitly allowlisted internal Docmost endpoints', async () => {
    const { controller } = createController();
    const fetchMock = mockFetchResponse(200);

    const result = await withEnv('ADMIN_OUTBOUND_PROBE_ALLOWLIST', '127.0.0.1', () =>
      withEnv('DOCMOST_BASE_URL', 'http://127.0.0.1:3000', () => controller.getHealth()),
    );

    expect(result.status).toBe('healthy');
    expect(result.components.docmost_bridge.status).toBe('healthy');
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3000/api/health', {
      method: 'GET',
      redirect: 'manual',
      signal: expect.any(AbortSignal) as unknown,
      dispatcher: expect.any(Object) as unknown,
    });
  });

  it('rejects credential-bearing Docmost URLs before fetching', async () => {
    const { controller } = createController();
    const fetchMock = mockFetchResponse(200);

    const result = await withEnv('DOCMOST_BASE_URL', 'https://user:pass@docmost.example.com', () =>
      controller.getHealth(),
    );

    expect(result.status).toBe('degraded');
    expect(result.components.docmost_bridge).toEqual(
      expect.objectContaining({
        status: 'unhealthy',
        error: expect.stringMatching(/URL credentials are not allowed/i) as unknown,
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dnsLookupMock).not.toHaveBeenCalled();
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

  it('sanitizes Docmost network errors before returning health metadata', async () => {
    const { controller } = createController();
    mockFetchError(new TypeError('network error Authorization: Bearer secret Cookie: sid=secret'));

    const result = await withEnv('DOCMOST_BASE_URL', 'https://docmost.example.com', () => controller.getHealth());

    expect(result.status).toBe('degraded');
    expect(result.components.docmost_bridge).toEqual(
      expect.objectContaining({
        status: 'unhealthy',
        error: 'Outbound request failed',
      }),
    );
  });

  it('sanitizes unlabeled tokens and URL credentials in Docmost health errors', async () => {
    const { controller } = createController();
    mockFetchError(new TypeError('failed sk-docmost-secret-1234567890 at https://user:pass@example.com?token=hidden'));

    const result = await withEnv('DOCMOST_BASE_URL', 'https://docmost.example.com', () => controller.getHealth());

    expect(result.status).toBe('degraded');
    expect(result.components.docmost_bridge).toEqual(
      expect.objectContaining({
        status: 'unhealthy',
        error: 'Outbound request failed',
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
        error: 'Health check timed out (5s total)',
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses one Docmost deadline across slow DNS validation and fetch timeout', async () => {
    vi.useFakeTimers();
    const { controller } = createController();
    const fetchMock = mockFetchTimeout();
    dnsLookupMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve([{ address: '93.184.216.34', family: 4 }] as unknown as Awaited<ReturnType<typeof dnsLookup>>);
          }, 4000);
        }),
    );

    await withEnv('DOCMOST_BASE_URL', 'https://slow-docmost.example', async () => {
      const resultPromise = controller.getHealth();

      await vi.advanceTimersByTimeAsync(4000);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(result.status).toBe('degraded');
      expect(result.components.docmost_bridge).toEqual({
        status: 'unhealthy',
        latency_ms: 5000,
        error: 'Health check timed out (5s total)',
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports Docmost unhealthy when DNS validation times out before fetching', async () => {
    vi.useFakeTimers();
    const { controller } = createController();
    const fetchMock = mockFetchResponse(200);
    dnsLookupMock.mockImplementation(() => new Promise(() => undefined));

    await withEnv('DOCMOST_BASE_URL', 'https://slow-dns.example', async () => {
      const resultPromise = controller.getHealth();

      await vi.advanceTimersByTimeAsync(5000);
      const result = await resultPromise;

      expect(result.status).toBe('degraded');
      expect(result.components.docmost_bridge).toEqual({
        status: 'unhealthy',
        latency_ms: 5000,
        error: expect.stringMatching(/DNS resolution timed out/i) as unknown,
      });
    });
    expect(fetchMock).not.toHaveBeenCalled();
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

function setDnsRecords(...addresses: string[]): void {
  dnsLookupMock.mockResolvedValue(
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })) as unknown as Awaited<
      ReturnType<typeof dnsLookup>
    >,
  );
}
