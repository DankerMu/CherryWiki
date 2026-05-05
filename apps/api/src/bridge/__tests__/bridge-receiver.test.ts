import 'reflect-metadata';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  ErrorCode,
  bridgeEvents,
  webhookDeliveries,
  type BridgeEventStatus,
  type BridgeEventType,
  type BridgeWebhookPayload,
} from '@cherrygraph/shared';
import crypto, { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureApp } from '../../main.js';
import { getApiLogger } from '../../common/logger/logger.module.js';
import { REDIS_CLIENT } from '../../common/redis/redis.module.js';
import { DRIZZLE } from '../../database/drizzle.constants.js';
import { BridgeAuthGuard } from '../bridge-auth.guard.js';
import { BridgeEventController } from '../bridge-event.controller.js';
import { BridgeEventService } from '../bridge-event.service.js';
import { BridgeRateLimitGuard } from '../bridge-rate-limit.guard.js';

const CURRENT_SECRET = 'bridge-current-secret';
const NEXT_SECRET = 'bridge-next-secret';
const BASE_PATH = '/api/internal/docmost/events';

type TestResponseData = {
  accepted: true;
  event_id: string;
  deduplicated: boolean;
};

type BridgeReceiverTestContext = {
  app: NestFastifyApplication;
  db: InMemoryBridgeDatabase;
  redis: InMemoryBridgeRedis;
};

const originalBridgeSecret = process.env.DOCMOST_BRIDGE_SECRET;
const originalBridgeSecretNext = process.env.DOCMOST_BRIDGE_SECRET_NEXT;
let context: BridgeReceiverTestContext | undefined;

describe('Bridge receiver contract', () => {
  beforeEach(async () => {
    getApiLogger().level = 'silent';
    process.env.DOCMOST_BRIDGE_SECRET = CURRENT_SECRET;
    process.env.DOCMOST_BRIDGE_SECRET_NEXT = NEXT_SECRET;
    context = await createBridgeReceiverTestContext();
  });

  afterEach(async () => {
    await context?.app.close();
    context = undefined;
    restoreBridgeSecrets();
  });

  it('accepts a request with a valid HMAC signature', async () => {
    const response = await sendSignedBridgeEvent(requireContext(), '/page-saved', createPayload('page.saved')).expect(200);

    expect(getResponseData(response).accepted).toBe(true);
    expect(getResponseData(response).deduplicated).toBe(false);
  });

  it('rejects a tampered HMAC signature with BRIDGE_HMAC_INVALID', async () => {
    const response = await sendSignedBridgeEvent(requireContext(), '/page-saved', createPayload('page.saved'), {
      signature: `sha256=${'0'.repeat(64)}`,
    }).expect(401);

    expect(getErrorCode(response)).toBe(ErrorCode.BRIDGE_HMAC_INVALID);
  });

  it('rejects a request without Authorization bearer with BRIDGE_AUTH_MISSING', async () => {
    const response = await sendSignedBridgeEvent(requireContext(), '/page-saved', createPayload('page.saved'), {
      omitAuthorization: true,
    }).expect(401);

    expect(getErrorCode(response)).toBe(ErrorCode.BRIDGE_AUTH_MISSING);
  });

  it('rejects a request with an expired timestamp with BRIDGE_TIMESTAMP_EXPIRED', async () => {
    const response = await sendSignedBridgeEvent(requireContext(), '/page-saved', createPayload('page.saved'), {
      timestamp: String(Math.floor(Date.now() / 1000) - 6 * 60),
    }).expect(401);

    expect(getErrorCode(response)).toBe(ErrorCode.BRIDGE_TIMESTAMP_EXPIRED);
  });

  it('rejects a reused nonce with BRIDGE_NONCE_REUSED', async () => {
    const nonce = randomUUID();

    await sendSignedBridgeEvent(requireContext(), '/page-saved', createPayload('page.saved'), { nonce }).expect(200);
    const response = await sendSignedBridgeEvent(requireContext(), '/page-saved', createPayload('page.saved'), {
      nonce,
    }).expect(401);

    expect(getErrorCode(response)).toBe(ErrorCode.BRIDGE_NONCE_REUSED);
  });

  it('accepts a request signed with DOCMOST_BRIDGE_SECRET_NEXT during dual-key rotation', async () => {
    const response = await sendSignedBridgeEvent(requireContext(), '/page-saved', createPayload('page.saved'), {
      secret: NEXT_SECRET,
      bearer: NEXT_SECRET,
    }).expect(200);

    expect(getResponseData(response).accepted).toBe(true);
  });

  it('deduplicates repeated event_id values without rejecting distinct nonces', async () => {
    const eventId = randomUUID();
    const firstPayload = createPayload('page.saved', { event_id: eventId });
    const secondPayload = createPayload('page.saved', { event_id: eventId });

    const firstResponse = await sendSignedBridgeEvent(requireContext(), '/page-saved', firstPayload).expect(200);
    const secondResponse = await sendSignedBridgeEvent(requireContext(), '/page-saved', secondPayload).expect(200);

    expect(getResponseData(firstResponse)).toEqual(
      expect.objectContaining({
        event_id: eventId,
        deduplicated: false,
      }),
    );
    expect(getResponseData(secondResponse)).toEqual(
      expect.objectContaining({
        event_id: eventId,
        deduplicated: true,
      }),
    );
    expect(requireContext().db.eventCount(eventId)).toBe(1);
  });

  it('returns 429 when the per-IP Bridge rate limit is exceeded', async () => {
    const testContext = requireContext();

    for (let index = 0; index < 100; index += 1) {
      await sendSignedBridgeEvent(testContext, '/page-saved', createPayload('page.saved')).expect(200);
    }

    const response = await sendSignedBridgeEvent(testContext, '/page-saved', createPayload('page.saved')).expect(429);
    expect(getErrorCode(response)).toBe(ErrorCode.RATE_LIMITED);
  });

  it.each([
    ['/page-saved', 'page.saved', { page_id: 'page-1', content_hash: 'a'.repeat(64) }],
    ['/page-deleted', 'page.deleted', { page_id: 'page-1' }],
    ['/attachment-created', 'attachment.created', { page_id: 'page-1', attachment_id: 'att-1', filename: 'guide.pdf' }],
    ['/attachment-deleted', 'attachment.deleted', { page_id: 'page-1', attachment_id: 'att-1' }],
    ['/space-updated', 'space.updated', { change_type: 'permissions' }],
  ] as const)('POST %s accepts a valid %s payload', async (path, eventType, overrides) => {
    const response = await sendSignedBridgeEvent(
      requireContext(),
      path,
      createPayload(eventType, overrides),
    ).expect(200);

    expect(getResponseData(response)).toEqual(
      expect.objectContaining({
        accepted: true,
        deduplicated: false,
      }),
    );
  });
});

async function createBridgeReceiverTestContext(): Promise<BridgeReceiverTestContext> {
  const redis = new InMemoryBridgeRedis();
  const db = new InMemoryBridgeDatabase();
  const moduleRef = await Test.createTestingModule({
    controllers: [BridgeEventController],
    providers: [
      BridgeAuthGuard,
      BridgeRateLimitGuard,
      BridgeEventService,
      { provide: DRIZZLE, useValue: db },
      { provide: REDIS_CLIENT, useValue: redis },
    ],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }), {
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return { app, db, redis };
}

function sendSignedBridgeEvent(
  testContext: BridgeReceiverTestContext,
  path: string,
  payload: BridgeWebhookPayload,
  options: Partial<{
    bearer: string;
    nonce: string;
    omitAuthorization: boolean;
    secret: string;
    signature: string;
    timestamp: string;
  }> = {},
): request.Test {
  const endpoint = `${BASE_PATH}${path}`;
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = options.nonce ?? randomUUID();
  const body = JSON.stringify(payload);
  const secret = options.secret ?? CURRENT_SECRET;
  const signature = options.signature ?? signBridgeRequest(secret, timestamp, nonce, 'POST', endpoint, body);
  const requestBuilder = request(testContext.app.getHttpAdapter().getInstance().server)
    .post(endpoint)
    .set('Content-Type', 'application/json')
    .set('X-Bridge-Timestamp', timestamp)
    .set('X-Bridge-Nonce', nonce)
    .set('X-Bridge-Signature', signature);

  if (options.omitAuthorization !== true) {
    requestBuilder.set('Authorization', `Bearer ${options.bearer ?? secret}`);
  }

  return requestBuilder.send(body);
}

function signBridgeRequest(
  secret: string,
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  body: string,
): string {
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const signaturePayload = `${timestamp}\n${nonce}\n${method}\n${path}\n${bodyHash}`;
  const signature = crypto.createHmac('sha256', secret).update(signaturePayload).digest('hex');

  return `sha256=${signature}`;
}

function createPayload(
  eventType: BridgeEventType,
  overrides: Record<string, unknown> = {},
): BridgeWebhookPayload {
  return {
    event_id: randomUUID(),
    event_type: eventType,
    timestamp: Math.floor(Date.now() / 1000),
    space_id: 'docmost-space-1',
    page_id: 'docmost-page-1',
    ...overrides,
  };
}

function getResponseData(response: Response): TestResponseData {
  const body = parseResponseBody(response);
  if (!isRecord(body.data)) {
    throw new Error('Expected response body to include data object');
  }

  return body.data as TestResponseData;
}

function getErrorCode(response: Response): unknown {
  const body = parseResponseBody(response);
  return isRecord(body.error) ? body.error.code : undefined;
}

function parseResponseBody(response: Response): Record<string, unknown> {
  const body = response.body as unknown;
  if (isRecord(body)) {
    return body;
  }

  const parsed = JSON.parse(response.text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object response body');
  }

  return parsed;
}

function requireContext(): BridgeReceiverTestContext {
  if (context === undefined) {
    throw new Error('Expected test context to be initialized');
  }

  return context;
}

function restoreBridgeSecrets(): void {
  restoreEnvValue('DOCMOST_BRIDGE_SECRET', originalBridgeSecret);
  restoreEnvValue('DOCMOST_BRIDGE_SECRET_NEXT', originalBridgeSecretNext);
}

function restoreEnvValue(name: 'DOCMOST_BRIDGE_SECRET' | 'DOCMOST_BRIDGE_SECRET_NEXT', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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
  readonly deliveries: unknown[] = [];

  insert(table: unknown): unknown {
    if (table === bridgeEvents) {
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

            const event: StoredBridgeEvent = {
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

    if (table === webhookDeliveries) {
      return {
        values: (value: Record<string, unknown>): Promise<void> => {
          this.deliveries.push(value);
          return Promise.resolve();
        },
      };
    }

    throw new Error('Unexpected insert table');
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

  eventCount(eventId: string): number {
    return this.eventsByEventId.has(eventId) ? 1 : 0;
  }
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
  if (value === 'received' || value === 'processing' || value === 'processed' || value === 'failed') {
    return value;
  }

  throw new Error('Expected bridge event status');
}

class InMemoryBridgeRedis {
  private readonly strings = new Map<string, { value: string; expiresAt: number }>();
  private readonly sortedSets = new Map<string, Array<{ score: number; member: string }>>();

  set(key: string, value: string, mode: 'EX', ttl: number, condition: 'NX'): Promise<'OK' | null> {
    if (mode !== 'EX' || condition !== 'NX') {
      return Promise.reject(new Error('Unsupported Redis SET arguments'));
    }

    this.deleteExpiredString(key);
    if (this.strings.has(key)) {
      return Promise.resolve(null);
    }

    this.strings.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000,
    });
    return Promise.resolve('OK');
  }

  eval(_script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<[number, number]> {
    if (numberOfKeys !== 1) {
      return Promise.reject(new Error('Unsupported Redis EVAL key count'));
    }

    const [key, nowValue, windowMsValue, limitValue, memberValue] = args;
    if (typeof key !== 'string' || typeof memberValue !== 'string') {
      return Promise.reject(new Error('Invalid Redis EVAL arguments'));
    }

    const now = Number(nowValue);
    const windowMs = Number(windowMsValue);
    const limit = Number(limitValue);
    const entries = this.sortedSets.get(key) ?? [];
    const kept = entries.filter((entry) => entry.score > now - windowMs);
    this.sortedSets.set(key, kept);

    if (kept.length >= limit) {
      return Promise.resolve([0, kept.length]);
    }

    kept.push({ score: now, member: memberValue });
    return Promise.resolve([1, kept.length]);
  }

  private deleteExpiredString(key: string): void {
    const entry = this.strings.get(key);
    if (entry !== undefined && entry.expiresAt <= Date.now()) {
      this.strings.delete(key);
    }
  }
}
