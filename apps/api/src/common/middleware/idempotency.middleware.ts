import { Inject, Injectable, Optional, type NestMiddleware } from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

import { getApiLogger } from '../logger/logger.module.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { getRequestContext } from './request-context.middleware.js';

const IDEMPOTENCY_HEADER = 'x-idempotency-key';
const IDEMPOTENCY_REPLAYED_HEADER = 'X-Idempotent-Replayed';
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const IDEMPOTENCY_PROCESSING_TTL_SECONDS = 300;
const IDEMPOTENCY_PROCESSING_VALUE = 'processing';
const MAX_CACHED_RESPONSE_BYTES = 1_048_576;
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IdempotencyRedisStore = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, condition: 'NX', expirationMode: 'EX', seconds: number) => Promise<'OK' | null>;
  setex: (key: string, seconds: number, value: string) => Promise<unknown>;
  del?: (key: string) => Promise<unknown>;
};

type RequestWithHeaders = IncomingMessage & {
  headers: IncomingHttpHeaders;
  path?: string;
  raw?: {
    path?: string;
    url?: string;
  };
};

type StoredIdempotentResponse = {
  statusCode: number;
  body: string;
  contentType?: string;
};

type IdempotencyReservation =
  | { kind: 'reserved' }
  | { kind: 'processing' }
  | { kind: 'replay'; response: StoredIdempotentResponse }
  | { kind: 'unavailable' };

type CaptureState = {
  chunks: Buffer[];
  totalBytes: number;
  exceededSizeLimit: boolean;
};

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis?: IdempotencyRedisStore) {}

  async use(req: RequestWithHeaders, res: ServerResponse, next: () => void): Promise<void> {
    const idempotencyKey = extractHeaderValue(req.headers[IDEMPOTENCY_HEADER]);
    if (idempotencyKey === undefined || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey) || this.redis === undefined) {
      next();
      return;
    }

    const redisKey = buildIdempotencyRedisKey(req, idempotencyKey);
    const reservation = await reserveOrReadExisting(this.redis, redisKey);

    if (reservation.kind === 'replay') {
      replayResponse(res, reservation.response);
      return;
    }

    if (reservation.kind === 'processing') {
      sendProcessingConflict(res);
      return;
    }

    if (reservation.kind === 'reserved') {
      captureAndStoreResponse(this.redis, redisKey, res);
    }

    next();
  }
}

function extractHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function buildIdempotencyRedisKey(req: RequestWithHeaders, idempotencyKey: string): string {
  const method = (req.method ?? 'UNKNOWN').toUpperCase();
  const path = getRequestPath(req);
  const userId = getRequestContext()?.user_id || 'anon';
  return `idempotency:${method}:${path}:${userId}:${idempotencyKey}`;
}

function getRequestPath(req: RequestWithHeaders): string {
  const rawPath = req.path ?? req.raw?.path ?? req.url ?? req.raw?.url ?? '/';
  try {
    return new URL(rawPath, 'http://localhost').pathname || '/';
  } catch {
    const queryIndex = rawPath.indexOf('?');
    const path = queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex);
    return path.length > 0 ? path : '/';
  }
}

async function reserveOrReadExisting(
  redis: IdempotencyRedisStore,
  redisKey: string,
): Promise<IdempotencyReservation> {
  try {
    const reserved = await redis.set(
      redisKey,
      IDEMPOTENCY_PROCESSING_VALUE,
      'NX',
      'EX',
      IDEMPOTENCY_PROCESSING_TTL_SECONDS,
    );
    if (reserved === 'OK') {
      return { kind: 'reserved' };
    }

    const cached = await redis.get(redisKey);
    if (cached === null) {
      return { kind: 'unavailable' };
    }

    if (cached === IDEMPOTENCY_PROCESSING_VALUE) {
      return { kind: 'processing' };
    }

    const response = parseStoredResponse(cached);
    return response === undefined ? { kind: 'unavailable' } : { kind: 'replay', response };
  } catch (err) {
    getApiLogger().warn({ err, redis_key: redisKey }, 'Failed to reserve idempotency key');
    return { kind: 'unavailable' };
  }
}

function replayResponse(res: ServerResponse, stored: StoredIdempotentResponse): void {
  res.statusCode = 200;
  res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
  if (stored.contentType !== undefined) {
    res.setHeader('content-type', stored.contentType);
  }

  res.end(stored.body);
}

function sendProcessingConflict(res: ServerResponse): void {
  res.statusCode = 409;
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      error: {
        code: ErrorCode.CONFLICT,
        message: 'Idempotency key is already processing',
      },
      meta: { request_id: getRequestContext()?.request_id ?? '' },
    }),
  );
}

function captureAndStoreResponse(redis: IdempotencyRedisStore, redisKey: string, res: ServerResponse): void {
  const capture: CaptureState = {
    chunks: [],
    totalBytes: 0,
    exceededSizeLimit: false,
  };
  const originalWrite = res.write.bind(res) as (...args: unknown[]) => boolean;
  const originalEnd = res.end.bind(res) as (...args: unknown[]) => ServerResponse;
  let forwardingEndChunk = false;

  res.write = ((...args: unknown[]): boolean => {
    if (!forwardingEndChunk) {
      captureChunk(args[0], capture, getChunkEncoding(args));
    }

    return originalWrite(...args);
  }) as ServerResponse['write'];

  res.end = ((...args: unknown[]): ServerResponse => {
    captureChunk(args[0], capture, getChunkEncoding(args));
    forwardingEndChunk = true;
    try {
      return originalEnd(...args);
    } finally {
      forwardingEndChunk = false;
    }
  }) as ServerResponse['end'];

  res.once('finish', () => {
    const contentType = headerValueToString(res.getHeader('content-type'));
    if (!isCacheableResponse(res.statusCode, contentType, capture)) {
      void clearReservation(redis, redisKey);
      return;
    }

    const body = Buffer.concat(capture.chunks).toString('utf8');
    const stored = createStoredResponse(res.statusCode, body, contentType);

    void redis.setex(redisKey, IDEMPOTENCY_TTL_SECONDS, JSON.stringify(stored)).catch((err: unknown) => {
      getApiLogger().warn({ err, redis_key: redisKey }, 'Failed to store idempotency response');
    });
  });
}

function captureChunk(chunk: unknown, capture: CaptureState, encoding: BufferEncoding | undefined): void {
  if (capture.exceededSizeLimit) {
    return;
  }

  const buffer = chunkToBuffer(chunk, encoding);
  if (buffer === undefined) {
    return;
  }

  const totalBytes = capture.totalBytes + buffer.byteLength;
  if (totalBytes > MAX_CACHED_RESPONSE_BYTES) {
    capture.exceededSizeLimit = true;
    capture.chunks = [];
    return;
  }

  capture.totalBytes = totalBytes;
  capture.chunks.push(buffer);
}

function getChunkEncoding(args: unknown[]): BufferEncoding | undefined {
  return typeof args[1] === 'string' ? (args[1] as BufferEncoding) : undefined;
}

function chunkToBuffer(chunk: unknown, encoding: BufferEncoding | undefined): Buffer | undefined {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, encoding);
  }

  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }

  return undefined;
}

function isCacheableResponse(statusCode: number, contentType: string | undefined, capture: CaptureState): boolean {
  return (
    statusCode >= 200 &&
    statusCode < 300 &&
    contentType !== undefined &&
    contentType.toLowerCase().startsWith('application/json') &&
    !capture.exceededSizeLimit
  );
}

async function clearReservation(redis: IdempotencyRedisStore, redisKey: string): Promise<void> {
  try {
    await redis.del?.(redisKey);
  } catch (err) {
    getApiLogger().warn({ err, redis_key: redisKey }, 'Failed to clear idempotency reservation');
  }
}

function createStoredResponse(
  statusCode: number,
  body: string,
  contentType: string | undefined,
): StoredIdempotentResponse {
  if (contentType === undefined) {
    return { statusCode, body };
  }

  return { statusCode, body, contentType };
}

function parseStoredResponse(value: string): StoredIdempotentResponse | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || typeof parsed.statusCode !== 'number' || typeof parsed.body !== 'string') {
    return undefined;
  }

  const response: StoredIdempotentResponse = {
    statusCode: parsed.statusCode,
    body: parsed.body,
  };

  if (typeof parsed.contentType === 'string') {
    response.contentType = parsed.contentType;
  }

  return response;
}

function headerValueToString(value: number | string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value === undefined ? undefined : String(value);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}
