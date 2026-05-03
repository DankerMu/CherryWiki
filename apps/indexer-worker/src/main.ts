import type { Worker } from 'bullmq';
import { eq, and, asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Pool as PgPool } from 'pg';

import { createBullMQConnection, QUEUE_INDEXING, type RedisJobLockClient } from '@cherrygraph/job-core';
import { OpenAIEmbeddingProvider, type EmbeddingProviderConfig } from '@cherrygraph/ai-core';
import { model_configs } from '@cherrygraph/shared';

import { closeHealthServer, startHealthServer } from './health.js';
import { IndexerWorker } from './indexer-worker.js';

const WORKER_NAME = 'indexer-worker';

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
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required to start indexer-worker');
  }

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const healthPort = parseHealthPort(process.env.WORKER_HEALTH_PORT);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  const db = drizzle(pool);
  const connection = createBullMQConnection(redisUrl);
  const embeddingProvider = new OpenAIEmbeddingProvider(await resolveEmbeddingProviderConfig(db));
  const indexerWorker = new IndexerWorker(db, connection as unknown as RedisJobLockClient, embeddingProvider, WORKER_NAME);
  const worker = indexerWorker.createWorker(QUEUE_INDEXING, connection);

  worker.on('error', (error) => {
    console.error(`${WORKER_NAME}: worker error`, error);
  });

  const healthServer = await startHealthServer(WORKER_NAME, healthPort);
  const shutdown = createShutdownHandler(worker, connection, pool, healthServer);
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  console.log(`${WORKER_NAME}: started`, { queue: QUEUE_INDEXING, healthPort });
}

function createShutdownHandler(
  worker: Worker,
  connection: ReturnType<typeof createBullMQConnection>,
  pool: PgPool,
  healthServer: Server,
): () => void {
  let shuttingDown = false;

  return () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    void shutdown(worker, connection, pool, healthServer);
  };
}

async function shutdown(
  worker: Worker,
  connection: ReturnType<typeof createBullMQConnection>,
  pool: PgPool,
  healthServer: Server,
): Promise<void> {
  let shutdownFailed = false;

  try {
    console.log(`${WORKER_NAME}: shutting down`);
    const results = await Promise.allSettled([worker.close(), connection.quit(), pool.end()]);
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

async function resolveEmbeddingProviderConfig(
  db: ReturnType<typeof drizzle>,
): Promise<EmbeddingProviderConfig> {
  const [modelConfig] = await db
    .select({
      provider: model_configs.provider,
      modelId: model_configs.model_id,
      baseUrl: model_configs.base_url,
      encryptedApiKeyRef: model_configs.encrypted_api_key_ref,
      embeddingDim: model_configs.embedding_dim,
    })
    .from(model_configs)
    .where(and(eq(model_configs.model_type, 'embedding'), eq(model_configs.enabled, true)))
    .orderBy(asc(model_configs.created_at))
    .limit(1);

  if (modelConfig === undefined) {
    throw new Error('No enabled embedding model configured');
  }

  if (modelConfig.encryptedApiKeyRef === null) {
    throw new Error(`Embedding model ${modelConfig.modelId} is missing encrypted_api_key_ref`);
  }

  return {
    provider: modelConfig.provider,
    modelId: modelConfig.modelId,
    encryptedApiKeyRef: modelConfig.encryptedApiKeyRef,
    ...(modelConfig.baseUrl !== null ? { baseUrl: modelConfig.baseUrl } : {}),
    ...(modelConfig.embeddingDim !== null ? { embeddingDim: modelConfig.embeddingDim } : {}),
  };
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isEntrypoint()) {
  await bootstrap();
}
