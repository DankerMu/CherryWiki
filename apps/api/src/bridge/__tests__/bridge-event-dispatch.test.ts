import {
  bridgeEvents,
  type BridgeEventStatus,
  type BridgeEventType,
  type BridgeWebhookPayload,
} from '@cherrygraph/shared';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { BridgeEventService } from '../bridge-event.service.js';
import type { BridgeQueueService } from '../bridge-queue.service.js';

describe('BridgeEventService queue dispatch', () => {
  it('enqueues a BullMQ job after a bridge event is persisted', async () => {
    const db = new InMemoryBridgeDatabase();
    const enqueueSpy = vi.fn(() => Promise.resolve());
    const queue = createBridgeQueueMock(enqueueSpy);
    const service = new BridgeEventService(db.asDb() as never, queue);
    const payload = createPayload('page.saved');

    await service.receiveEvent(payload);

    expect(enqueueSpy).toHaveBeenCalledWith('page.saved', expect.objectContaining({
      eventId: payload.event_id,
      eventType: 'page.saved',
      spaceId: 'space-1',
      pageId: 'page-1',
    }));
  });

  it('does not enqueue another job for a deduplicated event that is already processed', async () => {
    const db = new InMemoryBridgeDatabase();
    const enqueueSpy = vi.fn(() => Promise.resolve());
    const queue = createBridgeQueueMock(enqueueSpy);
    const service = new BridgeEventService(db.asDb() as never, queue);
    const eventId = randomUUID();

    await service.receiveEvent(createPayload('page.saved', { event_id: eventId }));
    db.setEventStatus(eventId, 'processed');
    const result = await service.receiveEvent(createPayload('page.saved', { event_id: eventId }));

    expect(result.deduplicated).toBe(true);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
  });

  it('re-enqueues on duplicate if event is not yet processed', async () => {
    const db = new InMemoryBridgeDatabase();
    const enqueueSpy = vi.fn(() => Promise.resolve());
    const queue = createBridgeQueueMock(enqueueSpy);
    const service = new BridgeEventService(db.asDb() as never, queue);
    const eventId = randomUUID();

    await service.receiveEvent(createPayload('page.saved', { event_id: eventId }));
    const result = await service.receiveEvent(createPayload('page.saved', { event_id: eventId }));

    expect(result.deduplicated).toBe(true);
    expect(enqueueSpy).toHaveBeenCalledTimes(2);
    expect(enqueueSpy).toHaveBeenLastCalledWith('page.saved', expect.objectContaining({
      eventId,
      eventType: 'page.saved',
      spaceId: 'space-1',
      pageId: 'page-1',
    }));
  });
});

type StoredBridgeEvent = {
  id: string;
  event_id: string;
  event_type: string;
  space_id: string | null;
  page_id: string | null;
  status: BridgeEventStatus;
};

class InMemoryBridgeDatabase {
  private readonly eventsByEventId = new Map<string, StoredBridgeEvent>();
  private pendingLookupEventId: string | undefined;

  insert(table: unknown): unknown {
    if (table !== bridgeEvents) {
      throw new Error('Unexpected insert table');
    }

    return {
      values: (value: Record<string, unknown>) => ({
        returning: (): Promise<StoredBridgeEvent[]> => {
          const eventId = requireString(value.event_id, 'event_id');
          const existing = this.eventsByEventId.get(eventId);
          if (existing !== undefined) {
            this.pendingLookupEventId = eventId;
            throw Object.assign(new Error('duplicate bridge event_id'), {
              code: '23505',
              constraint: 'bridge_events_event_id_unique',
            });
          }

          const event = {
            id: requireString(value.id, 'id'),
            event_id: eventId,
            event_type: requireString(value.event_type, 'event_type'),
            space_id: nullableString(value.space_id),
            page_id: nullableString(value.page_id),
            status: requireBridgeEventStatus(value.status),
          };
          this.eventsByEventId.set(event.event_id, event);

          return Promise.resolve([event]);
        },
      }),
    };
  }

  select(): unknown {
    return {
      from: (table: unknown) => ({
        where: () => ({
          limit: (): Promise<StoredBridgeEvent[]> => {
            if (table !== bridgeEvents || this.pendingLookupEventId === undefined) {
              return Promise.resolve([]);
            }

            const event = this.eventsByEventId.get(this.pendingLookupEventId);
            this.pendingLookupEventId = undefined;
            return Promise.resolve(event === undefined ? [] : [event]);
          },
        }),
      }),
    };
  }

  asDb(): unknown {
    return this;
  }

  setEventStatus(eventId: string, status: BridgeEventStatus): void {
    const event = this.eventsByEventId.get(eventId);
    if (event === undefined) {
      throw new Error(`Expected event ${eventId} to exist`);
    }

    this.eventsByEventId.set(eventId, { ...event, status });
  }
}

function createBridgeQueueMock(enqueueSpy: ReturnType<typeof vi.fn>): BridgeQueueService {
  return {
    enqueueBridgeJob: enqueueSpy,
  } as unknown as BridgeQueueService;
}

function createPayload(
  eventType: BridgeEventType,
  overrides: Partial<BridgeWebhookPayload> = {},
): BridgeWebhookPayload {
  return {
    event_id: randomUUID(),
    event_type: eventType,
    timestamp: Math.floor(Date.now() / 1000),
    space_id: 'space-1',
    page_id: 'page-1',
    ...overrides,
  };
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected ${fieldName} to be a string`);
  }

  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function requireBridgeEventStatus(value: unknown): BridgeEventStatus {
  if (
    value === 'received' ||
    value === 'processing' ||
    value === 'processed' ||
    value === 'failed'
  ) {
    return value;
  }

  throw new Error('Expected bridge event status');
}
