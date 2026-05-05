import {
  JobEventRepository,
  JobRepository,
  JobStateMachine,
  JobStatus,
  QueueFactory,
  QUEUE_INDEXING,
  RedisJobLock,
  type JobRow,
} from '@cherrygraph/job-core';
import { graphifyRuns } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BridgeQueueService } from '../../bridge/bridge-queue.service.js';
import { InternalJobsService } from '../internal-jobs.service.js';

describe('Graphify completion docmost push dispatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueues a docmost-push job when Graphify completion succeeds', async () => {
    const context = await runGraphifyCompletion();

    expect(context.bridgeQueue.enqueueDocmostPushJob).toHaveBeenCalledWith({
      runId: 'run-1',
      spaceId: 'space-1',
      tenantId: 'tenant-1',
    });
  });

  it('transitions the run from succeeded to docmost_syncing before enqueue', async () => {
    const context = await runGraphifyCompletion();

    expect(context.db.updates).toEqual([
      {
        table: graphifyRuns,
        values: {
          status: 'docmost_syncing',
        },
      },
    ]);
    expect(context.bridgeQueue.enqueueDocmostPushJob).toHaveBeenCalledTimes(1);
  });
});

type RunContext = {
  db: GraphifyDocmostDb;
  bridgeQueue: BridgeQueueService;
};

async function runGraphifyCompletion(): Promise<RunContext> {
  const db = new GraphifyDocmostDb();
  const redis = createRedisMock();
  const graphifyService = {
    handleRunCompletion: vi.fn(() => Promise.resolve({ status: 'succeeded', space_id: 'space-1' })),
  };
  const bridgeQueue = {
    enqueueDocmostPushJob: vi.fn(() => Promise.resolve()),
  } as unknown as BridgeQueueService;
  const service = new InternalJobsService(
    db.asDb() as never,
    redis.asClient() as never,
    undefined,
    undefined,
    graphifyService as never,
    bridgeQueue,
  );
  const runningJob = createJobRow({
    id: 'graphify-job-1',
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    type: 'graphify',
    status: JobStatus.RUNNING,
    locked_by: 'worker-1',
    locked_at: new Date('2026-05-05T11:55:00.000Z'),
    started_at: new Date('2026-05-05T11:55:00.000Z'),
    payload_json: { run_id: 'run-1' },
  });
  const completedJob = createJobRow({
    ...runningJob,
    status: JobStatus.SUCCEEDED,
    locked_by: null,
    locked_at: null,
    result_json: { graph_json_uri: 's3://bucket/graph.json' },
    completed_at: new Date('2026-05-05T12:00:00.000Z'),
  });
  const queue = {
    add: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };

  vi.spyOn(JobRepository, 'findById').mockResolvedValue(runningJob);
  vi.spyOn(RedisJobLock, 'renew').mockResolvedValue(true);
  vi.spyOn(JobStateMachine, 'transition').mockResolvedValue(completedJob);
  vi.spyOn(JobEventRepository, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof JobEventRepository.create>>);
  vi.spyOn(RedisJobLock, 'release').mockResolvedValue(true);
  vi.spyOn(JobRepository, 'create').mockResolvedValue(
    createJobRow({
      id: 'index-job-1',
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      queue_name: QUEUE_INDEXING,
      type: 'reindex',
    }),
  );
  vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(queue as never);

  await service.reportComplete('graphify-job-1', {
    worker_id: 'worker-1',
    result_json: { graph_json_uri: 's3://bucket/graph.json' },
  });

  return { db, bridgeQueue };
}

class GraphifyDocmostDb {
  readonly updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];

  async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    return callback(this);
  }

  update(table: unknown): {
    set: (values: Record<string, unknown>) => {
      where: () => Promise<void>;
    };
  } {
    return {
      set: (values) => ({
        where: () => {
          this.updates.push({ table, values });
          return Promise.resolve();
        },
      }),
    };
  }

  asDb(): unknown {
    return this;
  }
}

class RedisMemoryStore {
  readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<'OK'> {
    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  eval(): Promise<number> {
    return Promise.resolve(1);
  }

  asClient(): {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, ...args: Array<string | number>) => Promise<string | null>;
    eval: (script: string, numKeys: number, ...args: Array<string | number>) => Promise<number>;
  } {
    return {
      get: this.get.bind(this),
      set: async (key: string, value: string): Promise<string | null> => this.set(key, value),
      eval: this.eval.bind(this),
    };
  }
}

function createRedisMock(): RedisMemoryStore {
  return new RedisMemoryStore();
}

function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    queue_name: 'graphify',
    type: 'graphify',
    priority: 100,
    status: JobStatus.PENDING,
    attempt_count: 0,
    max_attempts: 3,
    timeout_seconds: 600,
    locked_by: null,
    locked_at: null,
    next_run_at: null,
    cancel_requested_at: null,
    payload_json: { run_id: 'run-1' },
    result_json: null,
    error_json: null,
    idempotency_key: null,
    created_by: 'user-1',
    created_at: new Date('2026-05-05T11:50:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}
