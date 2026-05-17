import 'reflect-metadata';

import { PERMISSIONS_METADATA_KEY } from '@cherrygraph/auth-core';
import { describe, expect, it, vi } from 'vitest';

import { AdminWorkersController } from '../admin-workers.controller.js';

type RedisMock = {
  get: ReturnType<typeof vi.fn<(key: string) => Promise<string | null>>>;
  scan: ReturnType<typeof vi.fn<(cursor: string | number, ...args: Array<string | number>) => Promise<[string, string[]]>>>;
  ping: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
};

describe('AdminWorkersController', () => {
  it('classifies worker statuses and returns summary counts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T12:00:00.000Z'));
    const redis = createRedisMock({
      'worker:heartbeat:worker-online': heartbeat(10_000, { cpu: 0.2 }),
      'worker:heartbeat:worker-degraded': heartbeat(60_000),
      'worker:heartbeat:worker-stale': heartbeat(150_000),
    });
    const controller = new AdminWorkersController(redis);

    const result = await controller.listWorkers();

    expect(result).toEqual({
      data: {
        workers: [
          {
            worker_id: 'worker-online',
            status: 'online',
            last_seen_at: '2026-05-17T11:59:50.000Z',
            system_info: { cpu: 0.2 },
          },
          {
            worker_id: 'worker-degraded',
            status: 'degraded',
            last_seen_at: '2026-05-17T11:59:00.000Z',
          },
          {
            worker_id: 'worker-stale',
            status: 'stale',
            last_seen_at: '2026-05-17T11:57:30.000Z',
          },
        ],
        summary: { total: 3, online: 1, degraded: 1, stale: 1 },
      },
    });
    expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', 'worker:heartbeat:*', 'COUNT', 100);
    vi.useRealTimers();
  });

  it('returns an empty summary when Redis has no heartbeat keys', async () => {
    const controller = new AdminWorkersController(createRedisMock({}));

    await expect(controller.listWorkers()).resolves.toEqual({
      data: {
        workers: [],
        summary: { total: 0, online: 0, degraded: 0, stale: 0 },
      },
    });
  });

  it('applies status threshold boundaries exactly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T12:00:00.000Z'));
    const controller = new AdminWorkersController(
      createRedisMock({
        'worker:heartbeat:a-online-boundary': heartbeat(29_999),
        'worker:heartbeat:b-degraded-start': heartbeat(30_000),
        'worker:heartbeat:c-degraded-end': heartbeat(119_999),
        'worker:heartbeat:d-stale-start': heartbeat(120_000),
      }),
    );

    const result = await controller.listWorkers();

    expect(result.data.workers.map((worker) => [worker.worker_id, worker.status])).toEqual([
      ['a-online-boundary', 'online'],
      ['b-degraded-start', 'degraded'],
      ['c-degraded-end', 'degraded'],
      ['d-stale-start', 'stale'],
    ]);
    expect(result.data.summary).toEqual({ total: 4, online: 1, degraded: 2, stale: 1 });
    vi.useRealTimers();
  });

  it('skips invalid JSON and keeps valid workers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T12:00:00.000Z'));
    const controller = new AdminWorkersController(
      createRedisMock({
        'worker:heartbeat:valid': heartbeat(10_000),
        'worker:heartbeat:invalid': '{not json',
        'worker:heartbeat:missing-seen-at': JSON.stringify({ system_info: { cpu: 1 } }),
      }),
    );

    const result = await controller.listWorkers();

    expect(result.data.workers).toEqual([
      {
        worker_id: 'valid',
        status: 'online',
        last_seen_at: '2026-05-17T11:59:50.000Z',
      },
    ]);
    expect(result.data.summary).toEqual({ total: 1, online: 1, degraded: 0, stale: 0 });
    vi.useRealTimers();
  });

  it('requires admin audit view permission', () => {
    expect(Reflect.getMetadata(PERMISSIONS_METADATA_KEY, AdminWorkersController)).toEqual(['admin:audit_view']);
  });

  it('returns an empty response with an error when Redis is unavailable', async () => {
    const controller = new AdminWorkersController(undefined);

    await expect(controller.listWorkers()).resolves.toEqual({
      data: {
        workers: [],
        summary: { total: 0, online: 0, degraded: 0, stale: 0 },
      },
      error: 'Redis unavailable',
    });
  });
});

function createRedisMock(values: Record<string, string>): RedisMock {
  const keys = Object.keys(values);
  return {
    get: vi.fn((key) => Promise.resolve(values[key] ?? null)),
    scan: vi.fn((cursor) => Promise.resolve(cursor === '0' ? ['0', keys] : ['0', []])),
    ping: vi.fn(() => Promise.resolve('PONG')),
  };
}

function heartbeat(ageMs: number, systemInfo?: Record<string, unknown>): string {
  return JSON.stringify({
    seen_at: new Date(Date.now() - ageMs).toISOString(),
    ...(systemInfo !== undefined ? { system_info: systemInfo } : {}),
  });
}
