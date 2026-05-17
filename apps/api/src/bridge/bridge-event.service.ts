import { Inject, Injectable, Optional } from '@nestjs/common';
import { bridgeEvents, type BridgeEventType, type BridgeWebhookPayload, webhookDeliveries } from '@cherrygraph/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { getApiLogger } from '../common/logger/logger.module.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import type { DrizzleDatabase } from '../database/drizzle.module.js';
import { BridgeQueueService } from './bridge-queue.service.js';

export type ReceiveBridgeEventMetadata = {
  nonce?: string | undefined;
  receivedAt?: Date | undefined;
};

export type ReceiveBridgeEventResult = {
  accepted: true;
  deduplicated: boolean;
  event_id: string;
  event_type: BridgeEventType;
  bridge_event_id: string;
  space_id?: string;
  page_id?: string;
};

export type InboundDeliveryMetadata = {
  statusCode: number;
  responseTimeMs: number;
  error?: string;
};

type BridgeEventRow = {
  id: string;
  event_id: string;
  event_type: string;
  space_id: string | null;
  page_id: string | null;
  status: string;
};

@Injectable()
export class BridgeEventService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
    @Optional() private readonly bridgeQueueService?: BridgeQueueService,
  ) {}

  async receiveEvent(
    payload: BridgeWebhookPayload,
    metadata: ReceiveBridgeEventMetadata = {},
  ): Promise<ReceiveBridgeEventResult> {
    const now = metadata.receivedAt ?? new Date();

    try {
      const [event] = await this.db
        .insert(bridgeEvents)
        .values({
          id: randomUUID(),
          event_id: payload.event_id,
          event_type: payload.event_type,
          source: 'docmost',
          space_id: payload.space_id ?? null,
          page_id: payload.page_id ?? null,
          payload,
          status: 'received',
          nonce: metadata.nonce ?? null,
          received_at: now,
          created_at: now,
        })
        .returning({
          id: bridgeEvents.id,
          event_id: bridgeEvents.event_id,
          event_type: bridgeEvents.event_type,
          space_id: bridgeEvents.space_id,
          page_id: bridgeEvents.page_id,
          status: bridgeEvents.status,
        });

      if (event === undefined) {
        throw new Error('Failed to persist bridge event');
      }

      try {
        await this.bridgeQueueService?.enqueueBridgeJob(event.event_type as BridgeEventType, toBridgeQueueJobData(event));
      } catch (enqueueError) {
        getApiLogger().error(
          { err: enqueueError, event_id: event.event_id, bridge_event_id: event.id },
          'Failed to enqueue bridge event after persist — reconciliation will recover',
        );
      }

      return toReceiveResult(event, false);
    } catch (err) {
      if (!isUniqueViolation(err, 'bridge_events_event_id_unique')) {
        throw err;
      }

      const event = await this.findEventByEventId(payload.event_id);
      if (event === undefined) {
        throw err;
      }

      if (event.status !== 'processed') {
        try {
          await this.bridgeQueueService?.enqueueBridgeJob(
            event.event_type as BridgeEventType,
            toBridgeQueueJobData(event),
          );
        } catch (enqueueError) {
          getApiLogger().error(
            { err: enqueueError, event_id: event.event_id, bridge_event_id: event.id },
            'Failed to re-enqueue deduplicated bridge event',
          );
        }
      }

      return toReceiveResult(event, true);
    }
  }

  async recordInboundDelivery(bridgeEventId: string, metadata: InboundDeliveryMetadata): Promise<void> {
    await this.db.insert(webhookDeliveries).values({
      id: randomUUID(),
      bridge_event_id: bridgeEventId,
      direction: 'inbound',
      attempt: 1,
      status_code: metadata.statusCode,
      response_time_ms: metadata.responseTimeMs,
      ...(metadata.error !== undefined ? { error: metadata.error } : {}),
    });
  }

  private async findEventByEventId(eventId: string): Promise<BridgeEventRow | undefined> {
    const [event] = await this.db
      .select({
        id: bridgeEvents.id,
        event_id: bridgeEvents.event_id,
        event_type: bridgeEvents.event_type,
        space_id: bridgeEvents.space_id,
        page_id: bridgeEvents.page_id,
        status: bridgeEvents.status,
      })
      .from(bridgeEvents)
      .where(eq(bridgeEvents.event_id, eventId))
      .limit(1);

    return event;
  }
}

function toReceiveResult(event: BridgeEventRow, deduplicated: boolean): ReceiveBridgeEventResult {
  return {
    accepted: true,
    deduplicated,
    event_id: event.event_id,
    event_type: event.event_type as BridgeEventType,
    bridge_event_id: event.id,
    ...(event.space_id !== null ? { space_id: event.space_id } : {}),
    ...(event.page_id !== null ? { page_id: event.page_id } : {}),
  };
}

function toBridgeQueueJobData(event: BridgeEventRow): {
  bridgeEventId: string;
  eventId: string;
  eventType: BridgeEventType;
  spaceId?: string;
  pageId?: string;
} {
  return {
    bridgeEventId: event.id,
    eventId: event.event_id,
    eventType: event.event_type as BridgeEventType,
    ...(event.space_id !== null ? { spaceId: event.space_id } : {}),
    ...(event.page_id !== null ? { pageId: event.page_id } : {}),
  };
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const seen = new WeakSet<object>();
  let current: unknown = err;

  while (isRecord(current)) {
    if (seen.has(current as object)) {
      return false;
    }
    seen.add(current as object);

    if (current.code === '23505') {
      if (current.constraint === constraint) {
        return true;
      }
      if (typeof current.detail === 'string' && current.detail.includes(constraint)) {
        return true;
      }
      if (current.constraint !== undefined) {
        return false;
      }
      return false;
    }

    current = current.cause;
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
