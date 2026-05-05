import { Inject, Injectable } from '@nestjs/common';
import { bridgeEvents, type BridgeEventType, type BridgeWebhookPayload, webhookDeliveries } from '@cherrygraph/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { DRIZZLE } from '../database/drizzle.constants.js';
import type { DrizzleDatabase } from '../database/drizzle.module.js';

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
};

@Injectable()
export class BridgeEventService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDatabase) {}

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
        });

      if (event === undefined) {
        throw new Error('Failed to persist bridge event');
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

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (!isRecord(err)) {
    return false;
  }

  return err.code === '23505' && (err.constraint === constraint || err.constraint === undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
