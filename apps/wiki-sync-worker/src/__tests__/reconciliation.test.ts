import { bridgeEvents } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reconcileOnStartup, type ReconciliationDb, type ReconciliationQueue } from '../reconciliation.js';

describe('wiki-sync-worker startup reconciliation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-enqueues received events and stale processing events', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));

    const db = new TestReconciliationDb([
      createBridgeEvent({ id: 'event-1', event_id: 'docmost-1', event_type: 'page.saved', status: 'received' }),
      createBridgeEvent({
        id: 'event-2',
        event_id: 'docmost-2',
        event_type: 'space.updated',
        status: 'processing',
        received_at: new Date('2026-05-05T11:54:00.000Z'),
      }),
      createBridgeEvent({
        id: 'event-3',
        event_id: 'docmost-3',
        event_type: 'attachment.created',
        status: 'processing',
        received_at: new Date('2026-05-05T11:59:00.000Z'),
      }),
    ]);
    const queues = createQueues();

    const enqueued = await reconcileOnStartup(db.asDb(), queues);

    expect(enqueued).toBe(2);
    expect(db.updated).toEqual([{ status: 'received' }]);
    expect(queues.pageSync.add).toHaveBeenCalledWith(
      'page.saved',
      {
        bridgeEventId: 'event-1',
        eventId: 'docmost-1',
        eventType: 'page.saved',
        spaceId: 'space-1',
        pageId: 'page-1',
      },
      { jobId: 'docmost-1' },
    );
    expect(queues.permissionSync.add).toHaveBeenCalledWith(
      'space.updated',
      {
        bridgeEventId: 'event-2',
        eventId: 'docmost-2',
        eventType: 'space.updated',
        spaceId: 'space-1',
        pageId: 'page-1',
      },
      { jobId: 'docmost-2' },
    );
    expect(queues.attachmentSync.add).not.toHaveBeenCalled();
    expect(queues.docmostPush.add).not.toHaveBeenCalled();
  });
});

type BridgeEventRow = typeof bridgeEvents.$inferSelect;

class TestReconciliationDb {
  readonly updated: Array<Partial<typeof bridgeEvents.$inferInsert>> = [];

  constructor(private readonly rows: BridgeEventRow[]) {}

  select(): {
    from: () => {
      where: () => Promise<BridgeEventRow[]>;
    };
  } {
    return {
      from: () => ({
        where: () => Promise.resolve(this.rows),
      }),
    };
  }

  update(): {
    set: (values: Partial<typeof bridgeEvents.$inferInsert>) => {
      where: () => Promise<void>;
    };
  } {
    return {
      set: (values) => ({
        where: () => {
          this.updated.push(values);
          return Promise.resolve();
        },
      }),
    };
  }

  asDb(): ReconciliationDb {
    return this as unknown as ReconciliationDb;
  }
}

function createQueues(): {
  pageSync: ReconciliationQueue & { add: ReturnType<typeof vi.fn> };
  permissionSync: ReconciliationQueue & { add: ReturnType<typeof vi.fn> };
  attachmentSync: ReconciliationQueue & { add: ReturnType<typeof vi.fn> };
  docmostPush: ReconciliationQueue & { add: ReturnType<typeof vi.fn> };
} {
  return {
    pageSync: { add: vi.fn(() => Promise.resolve()) },
    permissionSync: { add: vi.fn(() => Promise.resolve()) },
    attachmentSync: { add: vi.fn(() => Promise.resolve()) },
    docmostPush: { add: vi.fn(() => Promise.resolve()) },
  };
}

function createBridgeEvent(overrides: Partial<BridgeEventRow>): BridgeEventRow {
  return {
    id: 'event-1',
    event_id: 'docmost-event-1',
    event_type: 'page.saved',
    source: 'docmost',
    space_id: 'space-1',
    page_id: 'page-1',
    payload: {},
    status: 'received',
    error_json: null,
    nonce: null,
    received_at: new Date('2026-05-05T11:58:00.000Z'),
    processed_at: null,
    created_at: new Date('2026-05-05T11:58:00.000Z'),
    ...overrides,
  };
}
