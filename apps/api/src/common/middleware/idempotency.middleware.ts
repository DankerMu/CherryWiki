import { Inject, Injectable, Optional, type NestMiddleware } from '@nestjs/common';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

import { getApiLogger } from '../logger/logger.module.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

const IDEMPOTENCY_HEADER = 'x-idempotency-key';
const IDEMPOTENCY_REPLAYED_HEADER = 'X-Idempotent-Replayed';
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IdempotencyRedisStore = {
  get: (key: string) => Promise<string | null>;
  setex: (key: string, seconds: number, value: string) => Promise<unknown>;
};

type RequestWithHeaders = IncomingMessage & {
  headers: IncomingHttpHeaders;
};

type StoredIdempotentResponse = {
  statusCode: number;
  body: string;
  contentType?: string;
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

    const redisKey = `idempotency:${idempotencyKey}`;
    const cached = await readCachedResponse(this.redis, redisKey);
    if (cached !== undefined) {
      replayResponse(res, cached);
      return;
    }

    captureAndStoreResponse(this.redis, redisKey, res);
    next();
  }
}

function extractHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readCachedResponse(
  redis: IdempotencyRedisStore,
  redisKey: string,
): Promise<StoredIdempotentResponse | undefined> {
  try {
    const cached = await redis.get(redisKey);
    if (cached === null) {
      return undefined;
    }

    return parseStoredResponse(cached);
  } catch (err) {
    getApiLogger().warn({ err, redis_key: redisKey }, 'Failed to read idempotency response');
    return undefined;
  }
}

function replayResponse(res: ServerResponse, stored: StoredIdempotentResponse): void {
  res.statusCode = stored.statusCode;
  res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
  if (stored.contentType !== undefined) {
    res.setHeader('content-type', stored.contentType);
  }

  res.end(stored.body);
}

function captureAndStoreResponse(redis: IdempotencyRedisStore, redisKey: string, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  const originalWrite = res.write.bind(res) as (...args: unknown[]) => boolean;
  const originalEnd = res.end.bind(res) as (...args: unknown[]) => ServerResponse;
  let forwardingEndChunk = false;

  res.write = ((...args: unknown[]): boolean => {
    if (!forwardingEndChunk) {
      captureChunk(args[0], chunks);
    }

    return originalWrite(...args);
  }) as ServerResponse['write'];

  res.end = ((...args: unknown[]): ServerResponse => {
    captureChunk(args[0], chunks);
    forwardingEndChunk = true;
    try {
      return originalEnd(...args);
    } finally {
      forwardingEndChunk = false;
    }
  }) as ServerResponse['end'];

  res.once('finish', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const contentType = headerValueToString(res.getHeader('content-type'));
    const stored = createStoredResponse(res.statusCode, body, contentType);

    void redis.setex(redisKey, IDEMPOTENCY_TTL_SECONDS, JSON.stringify(stored)).catch((err: unknown) => {
      getApiLogger().warn({ err, redis_key: redisKey }, 'Failed to store idempotency response');
    });
  });
}

function captureChunk(chunk: unknown, chunks: Buffer[]): void {
  if (typeof chunk === 'string') {
    chunks.push(Buffer.from(chunk));
    return;
  }

  if (Buffer.isBuffer(chunk)) {
    chunks.push(chunk);
    return;
  }

  if (chunk instanceof Uint8Array) {
    chunks.push(Buffer.from(chunk));
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
  const parsed = JSON.parse(value) as unknown;
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
