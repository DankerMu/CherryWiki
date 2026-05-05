import { Queue, type JobsOptions, type Queue as BullQueue } from 'bullmq';
import { Redis } from 'ioredis';
import type { Redis as IORedis } from 'ioredis';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';

import { closeHealthServer, startHealthServer } from './health.js';

const WORKER_NAME = 'wiki-sync-worker';
const PAGE_SYNC_QUEUE = 'bridge-page-sync';
const PERMISSION_SYNC_QUEUE = 'bridge-permission-sync';
const ATTACHMENT_SYNC_QUEUE = 'bridge-attachment-sync';
const DOCMOST_PUSH_QUEUE = 'bridge-docmost-push';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5_000,
  },
  removeOnComplete: { count: 1000, age: 86_400 },
  removeOnFail: { count: 5000, age: 604_800 },
};

type BridgeWorkerQueues = {
  pageSync: BullQueue;
  permissionSync: BullQueue;
  attachmentSync: BullQueue;
  docmostPush: BullQueue;
};

export async function bootstrap(): Promise<void> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const healthPort = parseHealthPort(process.env.WORKER_HEALTH_PORT);
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queues = createQueues(connection);

  await reconcileQueuesOnStartup(queues);

  const healthServer = await startHealthServer(
    {
      'page-sync': queues.pageSync,
      'permission-sync': queues.permissionSync,
      'attachment-sync': queues.attachmentSync,
      'docmost-push': queues.docmostPush,
    },
    healthPort,
  );

  const shutdown = createShutdownHandler(queues, connection, healthServer);
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  console.log(`${WORKER_NAME}: started`, { healthPort });
}

function createQueues(connection: IORedis): BridgeWorkerQueues {
  const queueOptions = { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS };

  return {
    pageSync: new Queue(PAGE_SYNC_QUEUE, queueOptions),
    permissionSync: new Queue(PERMISSION_SYNC_QUEUE, queueOptions),
    attachmentSync: new Queue(ATTACHMENT_SYNC_QUEUE, queueOptions),
    docmostPush: new Queue(DOCMOST_PUSH_QUEUE, queueOptions),
  };
}

async function reconcileQueuesOnStartup(_queues: BridgeWorkerQueues): Promise<void> {
  // TODO(Issue #129): create the worker DB connection and call reconcileOnStartup(db, queues).
  console.warn('DB not connected — startup reconciliation skipped (will be wired in Issue #129)');
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
  connection: IORedis,
  healthServer: Server,
): () => void {
  let shuttingDown = false;

  return () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    void shutdown(queues, connection, healthServer);
  };
}

async function shutdown(
  queues: BridgeWorkerQueues,
  connection: IORedis,
  healthServer: Server,
): Promise<void> {
  let shutdownFailed = false;
  const queueList = [queues.pageSync, queues.permissionSync, queues.attachmentSync, queues.docmostPush];

  try {
    console.log(`${WORKER_NAME}: shutting down`);
    const results = await Promise.allSettled([
      ...queueList.map((queue) => queue.close()),
      connection.quit(),
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
