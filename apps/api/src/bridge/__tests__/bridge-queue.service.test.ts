import type { BridgeEventType } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getApiLogger } from '../../common/logger/logger.module.js';
import {
  BRIDGE_ATTACHMENT_SYNC_QUEUE,
  BRIDGE_PAGE_SYNC_QUEUE,
  BRIDGE_PERMISSION_SYNC_QUEUE,
  BRIDGE_SPACE_PROVISION_QUEUE,
  BRIDGE_USER_SYNC_QUEUE,
  BridgeQueueService,
} from '../bridge-queue.service.js';

type QueueMock = {
  name: string;
  add: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const queueMockState = vi.hoisted(() => {
  const state = {
    instances: [] as QueueMock[],
  };

  return {
    state,
    Queue: vi.fn(function Queue(name: string) {
      const queue = {
        name,
        add: vi.fn(() => Promise.resolve()),
        close: vi.fn(() => Promise.resolve()),
      };
      state.instances.push(queue);
      return queue;
    }),
  };
});

vi.mock('bullmq', () => ({
  Queue: queueMockState.Queue,
}));

describe('BridgeQueueService', () => {
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(() => {
    queueMockState.state.instances.length = 0;
    queueMockState.Queue.mockClear();
    restoreRedisUrl(originalRedisUrl);
    vi.restoreAllMocks();
  });

  it('routes page.saved events to bridge-page-sync', async () => {
    const service = createService();
    const jobData = createJobData('page.saved');

    await service.enqueueBridgeJob('page.saved', jobData);

    expect(queueByName(BRIDGE_PAGE_SYNC_QUEUE).add).toHaveBeenCalledWith('page.saved', jobData, {
      jobId: 'event-1',
      group: { id: 'page-1' },
    });
  });

  it('routes space.updated events to bridge-permission-sync', async () => {
    const service = createService();
    const jobData = createJobData('space.updated');

    await service.enqueueBridgeJob('space.updated', jobData);

    expect(queueByName(BRIDGE_PERMISSION_SYNC_QUEUE).add).toHaveBeenCalledWith('space.updated', jobData, {
      jobId: 'event-1',
    });
  });

  it.each(['attachment.created', 'attachment.deleted'] as const)(
    'routes %s events to bridge-attachment-sync',
    async (eventType) => {
      const service = createService();
      const jobData = createJobData(eventType);

      await service.enqueueBridgeJob(eventType, jobData);

      expect(queueByName(BRIDGE_ATTACHMENT_SYNC_QUEUE).add).toHaveBeenCalledWith(eventType, jobData, {
        jobId: 'event-1',
      });
    },
  );

  it('uses event_id as the BullMQ jobId for deduplication', async () => {
    const service = createService();
    const jobData = createJobData('page.deleted', { eventId: 'docmost-event-42' });

    await service.enqueueBridgeJob('page.deleted', jobData);

    expect(queueByName(BRIDGE_PAGE_SYNC_QUEUE).add).toHaveBeenCalledWith('page.deleted', jobData, {
      jobId: 'docmost-event-42',
      group: { id: 'page-1' },
    });
  });

  it('enqueues direct permission sync jobs with tenant-space deduplication', async () => {
    const service = createService();

    await service.enqueuePermissionSyncJob({ tenantId: 'tenant-1', spaceId: 'space-1' });

    expect(queueByName(BRIDGE_PERMISSION_SYNC_QUEUE).add).toHaveBeenCalledWith(
      'permission.sync',
      { tenantId: 'tenant-1', spaceId: 'space-1' },
      { jobId: 'tenant-1:space-1' },
    );
  });

  it('enqueues space provision jobs with tenant-space deduplication', async () => {
    const service = createService();

    await service.enqueueSpaceProvisionJob({
      tenantId: 'tenant-1',
      spaceId: 'space-1',
      spaceName: 'Research',
      spaceSlug: 'research',
    });

    expect(queueByName(BRIDGE_SPACE_PROVISION_QUEUE).add).toHaveBeenCalledWith(
      'space.provision',
      {
        tenantId: 'tenant-1',
        spaceId: 'space-1',
        spaceName: 'Research',
        spaceSlug: 'research',
      },
      { jobId: 'tenant-1:space-1' },
    );
  });

  it('enqueues user sync jobs with tenant-user deduplication', async () => {
    const service = createService();

    await service.enqueueUserSyncJob({
      tenantId: 'tenant-1',
      userId: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
    });

    expect(queueByName(BRIDGE_USER_SYNC_QUEUE).add).toHaveBeenCalledWith(
      'user.sync',
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
      },
      { jobId: 'tenant-1:user-1' },
    );
  });

  it('skips enqueue when Redis is not configured', async () => {
    delete process.env.REDIS_URL;
    const warn = vi.spyOn(getApiLogger(), 'warn').mockImplementation(() => undefined);
    const service = new BridgeQueueService();
    const jobData = createJobData('page.saved');

    await service.enqueueBridgeJob('page.saved', jobData);

    expect(queueMockState.Queue).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      { redis_configured: false },
      'BullMQ dispatch disabled — no Redis configured',
    );
  });
});

function createService(): BridgeQueueService {
  return new BridgeQueueService({} as never);
}

function createJobData(
  eventType: BridgeEventType,
  overrides: Partial<Parameters<BridgeQueueService['enqueueBridgeJob']>[1]> = {},
): Parameters<BridgeQueueService['enqueueBridgeJob']>[1] {
  return {
    bridgeEventId: 'bridge-event-1',
    eventId: 'event-1',
    eventType,
    spaceId: 'space-1',
    pageId: 'page-1',
    ...overrides,
  };
}

function queueByName(name: string): QueueMock {
  const queue = queueMockState.state.instances.find((instance) => instance.name === name);
  if (queue === undefined) {
    throw new Error(`Queue ${name} was not created`);
  }

  return queue;
}

function restoreRedisUrl(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.REDIS_URL;
    return;
  }

  process.env.REDIS_URL = value;
}
