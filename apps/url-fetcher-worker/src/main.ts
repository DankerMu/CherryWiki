import { Worker, type Job } from 'bullmq';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';

import { createBullMQConnection, QUEUE_URL_FETCH } from '@cherrygraph/job-core';

import { closeHealthServer, startHealthServer } from './health.js';

const WORKER_NAME = 'url-fetcher-worker';

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

export async function bootstrap(): Promise<void> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const healthPort = parseHealthPort(process.env.WORKER_HEALTH_PORT);
  const connection = createBullMQConnection(redisUrl);
  const worker = new Worker<unknown, unknown, string>(
    QUEUE_URL_FETCH,
    (job: Job<unknown, unknown, string>): Promise<void> => {
      console.log(`${WORKER_NAME}: job received, no-op`, { jobId: job.id, jobName: job.name });
      return Promise.resolve();
    },
    { connection },
  );

  worker.on('error', (error) => {
    console.error(`${WORKER_NAME}: worker error`, error);
  });

  const healthServer = await startHealthServer(WORKER_NAME, healthPort);
  const shutdown = createShutdownHandler(worker, connection, healthServer);
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  console.log(`${WORKER_NAME}: started`, { queue: QUEUE_URL_FETCH, healthPort });
}

function createShutdownHandler(
  worker: Worker<unknown, unknown, string>,
  connection: ReturnType<typeof createBullMQConnection>,
  healthServer: Server,
): () => void {
  let shuttingDown = false;

  return () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    void shutdown(worker, connection, healthServer);
  };
}

async function shutdown(
  worker: Worker<unknown, unknown, string>,
  connection: ReturnType<typeof createBullMQConnection>,
  healthServer: Server,
): Promise<void> {
  let shutdownFailed = false;

  try {
    console.log(`${WORKER_NAME}: shutting down`);
    const results = await Promise.allSettled([worker.close(), connection.quit()]);
    for (const result of results) {
      if (result.status === 'rejected') {
        shutdownFailed = true;
        console.error(`${WORKER_NAME}: shutdown step failed`, result.reason);
      }
    }
  } catch (error) {
    console.error(`${WORKER_NAME}: shutdown failed`, error);
    shutdownFailed = true;
  } finally {
    try {
      await closeHealthServer(healthServer);
    } catch (error) {
      console.error(`${WORKER_NAME}: health server shutdown failed`, error);
      shutdownFailed = true;
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
