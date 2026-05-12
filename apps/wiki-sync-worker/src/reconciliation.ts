import { bridgeEvents, type BridgeEventType } from '@cherrygraph/shared';
import { and, asc, eq, gt, lt, or } from 'drizzle-orm';

export type BridgeSyncJobData = {
  bridgeEventId: string;
  eventId: string;
  eventType: string;
  spaceId?: string;
  pageId?: string;
};

export type ReconciliationQueue = {
  add: (
    name: string,
    data: BridgeSyncJobData,
    opts: { jobId: string; group?: { id: string } },
  ) => Promise<unknown>;
};

export type ReconciliationQueues = {
  pageSync: ReconciliationQueue;
  permissionSync: ReconciliationQueue;
  attachmentSync: ReconciliationQueue;
  docmostPush: ReconciliationQueue;
};

type BridgeEventRow = typeof bridgeEvents.$inferSelect;
type BridgeEventInsert = typeof bridgeEvents.$inferInsert;
type ReconciliationCursor = {
  receivedAt: Date;
  id: string;
};

export type ReconciliationDb = {
  select: () => {
    from: (table: typeof bridgeEvents) => {
      where: (condition: unknown) => {
        orderBy: (...columns: unknown[]) => {
          limit: (limit: number) => PromiseLike<BridgeEventRow[]>;
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
  options: { batchSize?: number } = {},
): Promise<number> {
  const staleThreshold = new Date(Date.now() - STUCK_PROCESSING_MS);
  await db
    .update(bridgeEvents)
    .set({ status: 'received' })
    .where(
      and(eq(bridgeEvents.status, 'processing'), lt(bridgeEvents.received_at, staleThreshold)),
    );

  let enqueued = 0;
  let cursor: ReconciliationCursor | undefined;
  const batchSize = options.batchSize ?? RECONCILIATION_BATCH_SIZE;

  while (true) {
    const events = await db
      .select()
      .from(bridgeEvents)
      .where(receivedEventsCondition(cursor))
      .orderBy(asc(bridgeEvents.received_at), asc(bridgeEvents.id))
      .limit(batchSize);

    const results = await Promise.allSettled(events.map((event) => enqueueBridgeEvent(event, queues)));
    enqueued += results.filter((r) => r.status === 'fulfilled').length;

    if (events.length < batchSize) {
      return enqueued;
    }

    const last = events.at(-1);
    if (last === undefined) {
      return enqueued;
    }
    cursor = { receivedAt: last.received_at, id: last.id };
  }
}

function receivedEventsCondition(cursor: ReconciliationCursor | undefined): unknown {
  if (cursor === undefined) {
    return eq(bridgeEvents.status, 'received');
  }

  return and(
    eq(bridgeEvents.status, 'received'),
    or(
      gt(bridgeEvents.received_at, cursor.receivedAt),
      and(eq(bridgeEvents.received_at, cursor.receivedAt), gt(bridgeEvents.id, cursor.id)),
    ),
  );
}

async function enqueueBridgeEvent(
  event: BridgeEventRow,
  queues: ReconciliationQueues,
): Promise<void> {
  const queue = queueForEventType(event.event_type as BridgeEventType, queues);
  if (queue === undefined) {
    return;
  }

  const jobData = toJobData(event);
  await queue.add(
    event.event_type,
    jobData,
    bridgeSyncJobOptions(event.event_type as BridgeEventType, event.event_id, jobData),
  );
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

function bridgeSyncJobOptions(
  eventType: BridgeEventType,
  eventId: string,
  data: BridgeSyncJobData,
): { jobId: string; group?: { id: string } } {
  if ((eventType === 'page.saved' || eventType === 'page.deleted') && data.pageId !== undefined) {
    return { jobId: eventId, group: { id: data.pageId } };
  }

  return { jobId: eventId };
}
