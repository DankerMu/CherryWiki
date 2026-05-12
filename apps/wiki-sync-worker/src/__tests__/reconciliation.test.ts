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
      { jobId: 'docmost-1', group: { id: 'page-1' } },
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

  it('does not skip later received events when earlier statuses change between batches', async () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      createBridgeEvent({
        id: `event-${index + 1}`,
        event_id: `docmost-${index + 1}`,
        event_type: 'page.saved',
        status: 'received',
        received_at: new Date(`2026-05-05T12:00:0${index}.000Z`),
      }),
    );
    const db = new TestReconciliationDb(rows, (events, testDb) => {
      if (testDb.selectBatches.length === 1) {
        expect(events.map((event) => event.id)).toEqual(['event-1', 'event-2']);
        testDb.markStatus('event-1', 'processed');
      }
    });
    const queues = createQueues();

    const enqueued = await reconcileOnStartup(db.asDb(), queues, { batchSize: 2 });

    expect(enqueued).toBe(5);
    expect(db.selectBatches).toEqual([
      ['event-1', 'event-2'],
      ['event-3', 'event-4'],
      ['event-5'],
    ]);
    expect(queues.pageSync.add.mock.calls.map((call) => call[1].bridgeEventId)).toEqual([
      'event-1',
      'event-2',
      'event-3',
      'event-4',
      'event-5',
    ]);
    expect(rows.find((row) => row.id === 'event-1')?.status).toBe('processed');
  });
});

type BridgeEventRow = typeof bridgeEvents.$inferSelect;

class TestReconciliationDb {
  readonly updated: Array<Partial<typeof bridgeEvents.$inferInsert>> = [];
  readonly selectBatches: string[][] = [];

  constructor(
    private readonly rows: BridgeEventRow[],
    private readonly onAfterSelect?: (events: BridgeEventRow[], db: TestReconciliationDb) => void,
  ) {}

  markStatus(id: string, status: BridgeEventRow['status']): void {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row !== undefined) {
      row.status = status;
    }
  }

  select(): {
    from: () => {
      where: (condition: unknown) => {
        orderBy: () => {
          limit: (limit: number) => Promise<BridgeEventRow[]>;
        };
      };
    };
  } {
    return {
      from: () => ({
        where: (condition) => ({
          orderBy: () => ({
            limit: (limit) => {
              const events = this.rows
                .filter((row) => matchesSelectCondition(row, condition))
                .sort(compareBridgeEventRows)
                .slice(0, limit);
              this.selectBatches.push(events.map((event) => event.id));
              this.onAfterSelect?.(events, this);
              return Promise.resolve(events);
            },
          }),
        }),
      }),
    };
  }

  update(): {
    set: (values: Partial<typeof bridgeEvents.$inferInsert>) => {
      where: (condition: unknown) => Promise<void>;
    };
  } {
    return {
      set: (values) => ({
        where: (condition) => {
          this.updated.push(values);
          const params = extractSqlParams(condition);
          const status = params.find((param): param is string => typeof param === 'string');
          const threshold = params.find((param): param is Date => param instanceof Date);
          for (const row of this.rows) {
            if (row.status === status && (threshold === undefined || row.received_at < threshold)) {
              Object.assign(row, values);
            }
          }
          return Promise.resolve();
        },
      }),
    };
  }

  asDb(): ReconciliationDb {
    return this as unknown as ReconciliationDb;
  }
}

function matchesSelectCondition(row: BridgeEventRow, condition: unknown): boolean {
  const params = extractSqlParams(condition);
  const status = params.find((param): param is string => typeof param === 'string');
  if (row.status !== status) {
    return false;
  }

  const cursorReceivedAt = params.find((param): param is Date => param instanceof Date);
  const cursorId = params.find((param): param is string => typeof param === 'string' && param !== status);
  if (cursorReceivedAt === undefined || cursorId === undefined) {
    return true;
  }

  return (
    row.received_at.getTime() > cursorReceivedAt.getTime() ||
    (row.received_at.getTime() === cursorReceivedAt.getTime() && row.id > cursorId)
  );
}

function compareBridgeEventRows(a: BridgeEventRow, b: BridgeEventRow): number {
  return a.received_at.getTime() - b.received_at.getTime() || a.id.localeCompare(b.id);
}

function extractSqlParams(condition: unknown): unknown[] {
  const params: unknown[] = [];
  collectSqlParams(condition, params);
  return params;
}

function collectSqlParams(value: unknown, params: unknown[]): void {
  if (value === null || typeof value !== 'object') {
    return;
  }

  if (value.constructor.name === 'Param' && 'value' in value) {
    params.push(value.value);
  }

  const queryChunks = 'queryChunks' in value ? value.queryChunks : undefined;
  if (!Array.isArray(queryChunks)) {
    return;
  }

  for (const chunk of queryChunks) {
    collectSqlParams(chunk, params);
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
