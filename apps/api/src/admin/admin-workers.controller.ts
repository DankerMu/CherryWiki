import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { Permissions } from '@cherrygraph/auth-core';

import { REDIS_CLIENT } from '../common/redis/redis.module.js';

type WorkerStatus = 'online' | 'degraded' | 'stale';
type WorkerInfo = {
  worker_id: string;
  status: WorkerStatus;
  last_seen_at: string;
  system_info?: Record<string, unknown>;
};
type WorkersSummary = { total: number; online: number; degraded: number; stale: number };
type AdminWorkersResponse = {
  data: {
    workers: WorkerInfo[];
    summary: WorkersSummary;
  };
  error?: string;
};

type RedisClient = {
  get: (key: string) => Promise<string | null>;
  scan: (cursor: string | number, ...args: Array<string | number>) => Promise<[string, string[]]>;
  ping: () => Promise<unknown>;
};

const HEARTBEAT_KEY_PREFIX = 'worker:heartbeat:';
const HEARTBEAT_KEY_MATCH = `${HEARTBEAT_KEY_PREFIX}*`;
const ONLINE_THRESHOLD_MS = 30_000;
const STALE_THRESHOLD_MS = 120_000;
const STATUS_PRIORITY: Record<WorkerStatus, number> = {
  online: 0,
  degraded: 1,
  stale: 2,
};

@Permissions('admin:audit_view')
@Controller('admin/workers')
export class AdminWorkersController {
  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis?: RedisClient) {}

  @Get()
  async listWorkers(): Promise<AdminWorkersResponse> {
    if (this.redis === undefined) {
      return unavailableResponse();
    }

    try {
      const keys = await this.scanHeartbeatKeys();
      const workers = await this.loadWorkers(keys);
      workers.sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || a.worker_id.localeCompare(b.worker_id));

      return {
        data: {
          workers,
          summary: summarizeWorkers(workers),
        },
      };
    } catch {
      return unavailableResponse();
    }
  }

  private async scanHeartbeatKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await this.redis!.scan(cursor, 'MATCH', HEARTBEAT_KEY_MATCH, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }

  private async loadWorkers(keys: string[]): Promise<WorkerInfo[]> {
    const workers: WorkerInfo[] = [];
    const now = Date.now();

    for (const key of keys) {
      const worker = await this.loadWorker(key, now);
      if (worker !== null) {
        workers.push(worker);
      }
    }

    return workers;
  }

  private async loadWorker(key: string, now: number): Promise<WorkerInfo | null> {
    const stored = await this.redis!.get(key);
    if (stored === null) {
      return null;
    }

    const parsed = parseHeartbeat(stored);
    if (parsed === null) {
      return null;
    }

    return {
      worker_id: key.startsWith(HEARTBEAT_KEY_PREFIX) ? key.slice(HEARTBEAT_KEY_PREFIX.length) : key,
      status: classifyHeartbeat(now - parsed.seenAt.getTime()),
      last_seen_at: parsed.seenAt.toISOString(),
      ...(parsed.systemInfo !== undefined ? { system_info: parsed.systemInfo } : {}),
    };
  }
}

function parseHeartbeat(stored: string): { seenAt: Date; systemInfo?: Record<string, unknown> } | null {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed) || typeof parsed.seen_at !== 'string') {
      return null;
    }

    const seenAt = new Date(parsed.seen_at);
    if (Number.isNaN(seenAt.getTime())) {
      return null;
    }

    return {
      seenAt,
      ...(isRecord(parsed.system_info) ? { systemInfo: parsed.system_info } : {}),
    };
  } catch {
    return null;
  }
}

function classifyHeartbeat(ageMs: number): WorkerStatus {
  if (ageMs < ONLINE_THRESHOLD_MS) {
    return 'online';
  }
  if (ageMs < STALE_THRESHOLD_MS) {
    return 'degraded';
  }
  return 'stale';
}

function summarizeWorkers(workers: WorkerInfo[]): WorkersSummary {
  const summary: WorkersSummary = { total: workers.length, online: 0, degraded: 0, stale: 0 };
  for (const worker of workers) {
    summary[worker.status] += 1;
  }
  return summary;
}

function unavailableResponse(): AdminWorkersResponse {
  return {
    data: {
      workers: [],
      summary: { total: 0, online: 0, degraded: 0, stale: 0 },
    },
    error: 'Redis unavailable',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
