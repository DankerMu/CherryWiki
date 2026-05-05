import { bridgeEvents, type BridgeEventType } from '@cherrygraph/shared';
import { and, asc, eq, lt } from 'drizzle-orm';

export type BridgeSyncJobData = {
  bridgeEventId: string;
  eventId: string;
  eventType: string;
  spaceId?: string;
  pageId?: string;
};

export type ReconciliationQueue = {
  add: (name: string, data: BridgeSyncJobData, opts: { jobId: string }) => Promise<unknown>;
};

export type ReconciliationQueues = {
  pageSync: ReconciliationQueue;
  permissionSync: ReconciliationQueue;
  attachmentSync: ReconciliationQueue;
  docmostPush: ReconciliationQueue;
};

type BridgeEventRow = typeof bridgeEvents.$inferSelect;
type BridgeEventInsert = typeof bridgeEvents.$inferInsert;

export type ReconciliationDb = {
  select: () => {
    from: (table: typeof bridgeEvents) => {
      where: (condition: unknown) => {
        orderBy: (...columns: unknown[]) => {
          limit: (limit: number) => {
            offset: (offset: number) => Promise<BridgeEventRow[]>;
          };
        };
      };
    };
  };
  update: (table: typeof bridgeEvents) => {
    set: (values: Partial<BridgeEventInsert>) => {
      where: (condition: unknown) => Promise<unknown>;
    };
  };
};

const STUCK_PROCESSING_MS = 5 * 60 * 1000;
const RECONCILIATION_BATCH_SIZE = 50;

export async function reconcileOnStartup(
  db: ReconciliationDb,
  queues: ReconciliationQueues,
): Promise<number> {
  const staleThreshold = new Date(Date.now() - STUCK_PROCESSING_MS);
  await db
    .update(bridgeEvents)
    .set({ status: 'received' })
    .where(
      and(eq(bridgeEvents.status, 'processing'), lt(bridgeEvents.received_at, staleThreshold)),
    );

  let enqueued = 0;
  let offset = 0;

  while (true) {
    const events = await db
      .select()
      .from(bridgeEvents)
      .where(eq(bridgeEvents.status, 'received'))
      .orderBy(asc(bridgeEvents.received_at), asc(bridgeEvents.id))
      .limit(RECONCILIATION_BATCH_SIZE)
      .offset(offset);

    const results = await Promise.allSettled(events.map((event) => enqueueBridgeEvent(event, queues)));
    enqueued += results.filter((r) => r.status === 'fulfilled').length;

    if (events.length < RECONCILIATION_BATCH_SIZE) {
      return enqueued;
    }

    offset += RECONCILIATION_BATCH_SIZE;
  }
}

async function enqueueBridgeEvent(
  event: BridgeEventRow,
  queues: ReconciliationQueues,
): Promise<void> {
  const queue = queueForEventType(event.event_type as BridgeEventType, queues);
  if (queue === undefined) {
    return;
  }

  await queue.add(event.event_type, toJobData(event), { jobId: event.event_id });
}

function queueForEventType(
  eventType: BridgeEventType,
  queues: ReconciliationQueues,
): ReconciliationQueue | undefined {
  if (eventType === 'page.saved' || eventType === 'page.deleted') {
    return queues.pageSync;
  }

  if (eventType === 'space.updated') {
    return queues.permissionSync;
  }

  if (eventType.startsWith('attachment.')) {
    return queues.attachmentSync;
  }

  return undefined;
}

function toJobData(event: BridgeEventRow): BridgeSyncJobData {
  return {
    bridgeEventId: event.id,
    eventId: event.event_id,
    eventType: event.event_type,
    ...(event.space_id !== null ? { spaceId: event.space_id } : {}),
    ...(event.page_id !== null ? { pageId: event.page_id } : {}),
  };
}
