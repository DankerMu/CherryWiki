import { bridgeEvents, type BridgeEventType } from '@cherrygraph/shared';
import { and, eq, inArray, lt } from 'drizzle-orm';

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
      where: (condition: unknown) => Promise<BridgeEventRow[]>;
    };
  };
  update: (table: typeof bridgeEvents) => {
    set: (values: Partial<BridgeEventInsert>) => {
      where: (condition: unknown) => Promise<unknown>;
    };
  };
};

const STUCK_PROCESSING_MS = 5 * 60 * 1000;

export async function reconcileOnStartup(db: ReconciliationDb, queues: ReconciliationQueues): Promise<number> {
  const staleThreshold = new Date(Date.now() - STUCK_PROCESSING_MS);
  const events = await db
    .select()
    .from(bridgeEvents)
    .where(inArray(bridgeEvents.status, ['received', 'processing']));
  const eventsToEnqueue = events.filter(
    (event) => event.status === 'received' || isStaleProcessingEvent(event, staleThreshold),
  );

  if (eventsToEnqueue.some((event) => event.status === 'processing')) {
    await db
      .update(bridgeEvents)
      .set({ status: 'received' })
      .where(and(eq(bridgeEvents.status, 'processing'), lt(bridgeEvents.received_at, staleThreshold)));
  }

  await Promise.all(eventsToEnqueue.map((event) => enqueueBridgeEvent(event, queues)));
  return eventsToEnqueue.length;
}

async function enqueueBridgeEvent(event: BridgeEventRow, queues: ReconciliationQueues): Promise<void> {
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

function isStaleProcessingEvent(event: BridgeEventRow, staleThreshold: Date): boolean {
  return event.status === 'processing' && event.received_at < staleThreshold;
}
