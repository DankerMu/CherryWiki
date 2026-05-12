import { Queue, Worker, type JobsOptions, type Queue as BullQueue, type Worker as BullWorker } from 'bullmq';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import type { Redis as IORedis } from 'ioredis';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Pool as PgPool } from 'pg';

import { createBridgeClient } from './bridge-client.js';
import { closeHealthServer, startHealthServer } from './health.js';
import { reconcileOnStartup, type ReconciliationDb } from './reconciliation.js';
import { reconcilePermissions } from './reconciliation/permission-reconcile.js';
import { reconcileSpaces } from './reconciliation/space-reconcile.js';
import {
  createDocmostPushProcessor,
  type DocmostPushDeps,
} from './processors/docmost-push.processor.js';
import {
  createHttpBridgeClient,
  createPageSyncProcessor,
  type PageSyncDeps,
} from './processors/page-sync.processor.js';
import {
  createPermissionSyncProcessor,
  type PermissionSyncDeps,
} from './processors/permission-sync.processor.js';
import {
  BRIDGE_SPACE_PROVISION_QUEUE,
  createSpaceProvisionProcessor,
  type SpaceProvisionDeps,
} from './processors/space-provision.processor.js';

const WORKER_NAME = 'wiki-sync-worker';
const PAGE_SYNC_QUEUE = 'bridge-page-sync';
const PERMISSION_SYNC_QUEUE = 'bridge-permission-sync';
const ATTACHMENT_SYNC_QUEUE = 'bridge-attachment-sync';
const DOCMOST_PUSH_QUEUE = 'bridge-docmost-push';

const PAGE_SYNC_BACKOFF = {
  type: 'custom',
  delay: (attemptsMade: number): number =>
    [5_000, 30_000, 180_000][attemptsMade - 1] ?? 180_000,
};

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5_000,
  },
  removeOnComplete: { count: 1000, age: 86_400 },
  removeOnFail: { count: 5000, age: 604_800 },
};

const PAGE_SYNC_JOB_OPTIONS: JobsOptions = {
  ...DEFAULT_JOB_OPTIONS,
  backoff: {
    type: PAGE_SYNC_BACKOFF.type,
    delay: PAGE_SYNC_BACKOFF.delay(1),
  },
};

type BridgeWorkerQueues = {
  pageSync: BullQueue;
  permissionSync: BullQueue;
  attachmentSync: BullQueue;
  docmostPush: BullQueue;
  spaceProvision: BullQueue;
};

type BridgeWorkers = {
  pageSync: BullWorker;
  permissionSync: BullWorker;
  docmostPush: BullWorker;
  spaceProvision: BullWorker;
};

export async function bootstrap(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required to start wiki-sync-worker');
  }

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const healthPort = parseHealthPort(process.env.WORKER_HEALTH_PORT);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  const db = drizzle(pool);
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queues = createQueues(connection);

  await reconcileOnStartup(db as unknown as ReconciliationDb, queues);
  await reconcileSpaces(db as SpaceProvisionDeps['db'], queues.spaceProvision);

  const bridgeBaseUrl = process.env.DOCMOST_BRIDGE_BASE_URL ?? process.env.DOCMOST_BASE_URL ?? 'http://localhost:3000';
  const bridgeSecret = process.env.DOCMOST_BRIDGE_SECRET ?? process.env.DOCMOST_BRIDGE_TOKEN ?? '';
  const bridgeClient = createBridgeClient(bridgeBaseUrl, bridgeSecret);
  const workers = createWorkers(connection, {
    pageSync: {
      db,
      bridgeClient: createHttpBridgeClient(
        bridgeBaseUrl,
        process.env.DOCMOST_BRIDGE_SECRET ?? process.env.DOCMOST_BRIDGE_TOKEN,
      ),
      wikiRepoPath: process.env.WIKI_REPO_PATH ?? process.cwd(),
    },
    docmostPush: {
      db,
      bridgeClient,
    },
    permissionSync: {
      db,
      bridgeClient,
    },
    spaceProvision: {
      db,
      bridgeClient,
    },
  });
  const permissionReconcileTimer = startPermissionReconcileTimer(db, bridgeClient);
  const spaceReconcileTimer = startSpaceReconcileTimer(
    db as SpaceProvisionDeps['db'],
    queues.spaceProvision,
  );

  const healthServer = await startHealthServer(
    {
      'page-sync': queues.pageSync,
      'permission-sync': queues.permissionSync,
      'attachment-sync': queues.attachmentSync,
      'docmost-push': queues.docmostPush,
      'space-provision': queues.spaceProvision,
    },
    healthPort,
  );

  const shutdown = createShutdownHandler(
    queues,
    workers,
    connection,
    pool,
    healthServer,
    permissionReconcileTimer,
    spaceReconcileTimer,
  );
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  console.log(`${WORKER_NAME}: started`, { healthPort });
}

function createQueues(connection: IORedis): BridgeWorkerQueues {
  return {
    pageSync: new Queue(PAGE_SYNC_QUEUE, { connection, defaultJobOptions: PAGE_SYNC_JOB_OPTIONS }),
    permissionSync: new Queue(PERMISSION_SYNC_QUEUE, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    attachmentSync: new Queue(ATTACHMENT_SYNC_QUEUE, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    docmostPush: new Queue(DOCMOST_PUSH_QUEUE, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    spaceProvision: new Queue(BRIDGE_SPACE_PROVISION_QUEUE, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
  };
}

function createWorkers(
  connection: IORedis,
  deps: {
    pageSync: PageSyncDeps;
    permissionSync: PermissionSyncDeps;
    docmostPush: DocmostPushDeps;
    spaceProvision: SpaceProvisionDeps;
  },
): BridgeWorkers {
  const pageSync = new Worker(PAGE_SYNC_QUEUE, createPageSyncProcessor(deps.pageSync), {
    connection,
    concurrency: 3,
    settings: {
      backoffStrategy: (attemptsMade, type) =>
        type === PAGE_SYNC_BACKOFF.type ? PAGE_SYNC_BACKOFF.delay(attemptsMade) : 0,
    },
  });
  const docmostPush = new Worker(DOCMOST_PUSH_QUEUE, createDocmostPushProcessor(deps.docmostPush), {
    connection,
    concurrency: 1,
  });
  const permissionSync = new Worker(
    PERMISSION_SYNC_QUEUE,
    createPermissionSyncProcessor(deps.permissionSync),
    {
      connection,
      concurrency: 1,
    },
  );
  const spaceProvision = new Worker(
    BRIDGE_SPACE_PROVISION_QUEUE,
    createSpaceProvisionProcessor(deps.spaceProvision),
    {
      connection,
      concurrency: 1,
    },
  );

  pageSync.on('error', (error) => {
    console.error(`${WORKER_NAME}: page-sync worker error`, error);
  });
  docmostPush.on('error', (error) => {
    console.error(`${WORKER_NAME}: docmost-push worker error`, error);
  });
  permissionSync.on('error', (error) => {
    console.error(`${WORKER_NAME}: permission-sync worker error`, error);
  });
  spaceProvision.on('error', (error) => {
    console.error(`${WORKER_NAME}: space-provision worker error`, error);
  });

  return { pageSync, permissionSync, docmostPush, spaceProvision };
}

function startPermissionReconcileTimer(
  db: PermissionSyncDeps['db'],
  bridgeClient: PermissionSyncDeps['bridgeClient'],
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void reconcilePermissions(db, bridgeClient).catch((error: unknown) => {
      console.error(`${WORKER_NAME}: permission reconcile failed`, error);
    });
  }, 60 * 60 * 1000);
}

function startSpaceReconcileTimer(
  db: SpaceProvisionDeps['db'],
  queue: BridgeWorkerQueues['spaceProvision'],
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void reconcileSpaces(db, queue).catch((error: unknown) => {
      console.error(`${WORKER_NAME}: space reconcile failed`, error);
    });
  }, 10 * 60 * 1000);
}

function parseHealthPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return 9090;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`Invalid WORKER_HEALTH_PORT value: ${value}`);
  }

  return parsed;
}

function createShutdownHandler(
  queues: BridgeWorkerQueues,
  workers: BridgeWorkers,
  connection: IORedis,
  pool: PgPool,
  healthServer: Server,
  permissionReconcileTimer: ReturnType<typeof setInterval>,
  spaceReconcileTimer: ReturnType<typeof setInterval>,
): () => void {
  let shuttingDown = false;

  return () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    void shutdown(
      queues,
      workers,
      connection,
      pool,
      healthServer,
      permissionReconcileTimer,
      spaceReconcileTimer,
    );
  };
}

async function shutdown(
  queues: BridgeWorkerQueues,
  workers: BridgeWorkers,
  connection: IORedis,
  pool: PgPool,
  healthServer: Server,
  permissionReconcileTimer: ReturnType<typeof setInterval>,
  spaceReconcileTimer: ReturnType<typeof setInterval>,
): Promise<void> {
  let shutdownFailed = false;
  const queueList = [
    queues.pageSync,
    queues.permissionSync,
    queues.attachmentSync,
    queues.docmostPush,
    queues.spaceProvision,
  ];
  const workerList = [
    workers.pageSync,
    workers.permissionSync,
    workers.docmostPush,
    workers.spaceProvision,
  ];

  try {
    console.log(`${WORKER_NAME}: shutting down`);
    clearInterval(permissionReconcileTimer);
    clearInterval(spaceReconcileTimer);
    const results = await Promise.allSettled([
      ...workerList.map((worker) => worker.close()),
      ...queueList.map((queue) => queue.close()),
      connection.quit(),
      pool.end(),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        shutdownFailed = true;
        console.error(`${WORKER_NAME}: shutdown step failed`, result.reason);
      }
    }
  } catch (error) {
    shutdownFailed = true;
    console.error(`${WORKER_NAME}: shutdown failed`, error);
  } finally {
    try {
      await closeHealthServer(healthServer);
    } catch (error) {
      shutdownFailed = true;
      console.error(`${WORKER_NAME}: health server shutdown failed`, error);
    }
  }

  if (shutdownFailed) {
    process.exitCode = 1;
    return;
  }

  console.log(`${WORKER_NAME}: stopped`);
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isEntrypoint()) {
  await bootstrap();
}
