import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { Redis, type Redis as IORedis } from 'ioredis';

import type { BridgeEventType } from '@cherrygraph/shared';

import { REDIS_CLIENT, type OptionalRedisClient } from '../common/redis/redis.module.js';

export const BRIDGE_PAGE_SYNC_QUEUE = 'bridge:page-sync';
export const BRIDGE_PERMISSION_SYNC_QUEUE = 'bridge:permission-sync';
export const BRIDGE_ATTACHMENT_SYNC_QUEUE = 'bridge:attachment-sync';
export const BRIDGE_DOCMOST_PUSH_QUEUE = 'bridge:docmost-push';

export type BridgeQueueName =
  | typeof BRIDGE_PAGE_SYNC_QUEUE
  | typeof BRIDGE_PERMISSION_SYNC_QUEUE
  | typeof BRIDGE_ATTACHMENT_SYNC_QUEUE
  | typeof BRIDGE_DOCMOST_PUSH_QUEUE;

export type BridgeQueueJobData = {
  bridgeEventId: string;
  eventId: string;
  eventType: BridgeEventType;
  spaceId?: string;
  pageId?: string;
};

export type DocmostPushJobData = {
  runId: string;
  spaceId: string;
  tenantId: string;
};

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5_000,
  },
};

@Injectable()
export class BridgeQueueService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly ownsConnection: boolean;
  private readonly queues: Record<BridgeQueueName, Queue<BridgeQueueJobData | DocmostPushJobData>>;

  constructor(@Optional() @Inject(REDIS_CLIENT) redis?: OptionalRedisClient) {
    this.connection = redis ?? new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
    this.ownsConnection = redis === undefined;
    this.queues = {
      [BRIDGE_PAGE_SYNC_QUEUE]: new Queue(BRIDGE_PAGE_SYNC_QUEUE, {
        connection: this.connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
      [BRIDGE_PERMISSION_SYNC_QUEUE]: new Queue(BRIDGE_PERMISSION_SYNC_QUEUE, {
        connection: this.connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
      [BRIDGE_ATTACHMENT_SYNC_QUEUE]: new Queue(BRIDGE_ATTACHMENT_SYNC_QUEUE, {
        connection: this.connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
      [BRIDGE_DOCMOST_PUSH_QUEUE]: new Queue(BRIDGE_DOCMOST_PUSH_QUEUE, {
        connection: this.connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    };
  }

  async enqueueBridgeJob(eventType: BridgeEventType, jobData: BridgeQueueJobData): Promise<void> {
    const queueName = resolveBridgeQueueName(eventType);
    await this.queues[queueName].add(eventType, jobData, { jobId: jobData.eventId });
  }

  async enqueueDocmostPushJob(jobData: DocmostPushJobData): Promise<void> {
    await this.queues[BRIDGE_DOCMOST_PUSH_QUEUE].add('docmost.push', jobData, { jobId: jobData.runId });
  }

  async onModuleDestroy(): Promise<void> {
    const results = await Promise.allSettled(Object.values(this.queues).map((queue) => queue.close()));
    for (const result of results) {
      if (result.status === 'rejected') {
        throw result.reason;
      }
    }

    if (this.ownsConnection) {
      this.connection.disconnect();
    }
  }
}

export function resolveBridgeQueueName(eventType: BridgeEventType): BridgeQueueName {
  if (eventType === 'page.saved' || eventType === 'page.deleted') {
    return BRIDGE_PAGE_SYNC_QUEUE;
  }

  if (eventType === 'space.updated') {
    return BRIDGE_PERMISSION_SYNC_QUEUE;
  }

  return BRIDGE_ATTACHMENT_SYNC_QUEUE;
}
