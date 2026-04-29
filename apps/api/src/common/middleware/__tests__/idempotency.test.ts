import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';

import { IdempotencyMiddleware, type IdempotencyRedisStore } from '../idempotency.middleware.js';

const IDEMPOTENCY_KEY = '123e4567-e89b-42d3-a456-426614174000';

class MapRedisStore implements IdempotencyRedisStore {
  readonly values = new Map<string, string>();
  ttlSeconds: number | null = null;

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.ttlSeconds = seconds;
    this.values.set(key, value);
    return Promise.resolve('OK');
  }
}

class FakeResponse extends EventEmitter {
  statusCode = 200;
  readonly headers = new Map<string, string>();
  readonly chunks: Buffer[] = [];

  setHeader(name: string, value: number | string | string[]): this {
    this.headers.set(name.toLowerCase(), Array.isArray(value) ? String(value[0] ?? '') : String(value));
    return this;
  }

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    return true;
  }

  end(chunk?: string | Uint8Array): this {
    if (chunk !== undefined) {
      this.write(chunk);
    }

    this.emit('finish');
    return this;
  }

  get body(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

describe('IdempotencyMiddleware', () => {
  it('stores the first response and replays the second response for the same key', async () => {
    const redis = new MapRedisStore();
    const middleware = new IdempotencyMiddleware(redis);
    const firstResponse = new FakeResponse();
    let firstNextCalled = false;

    await middleware.use(createRequest(IDEMPOTENCY_KEY), asServerResponse(firstResponse), () => {
      firstNextCalled = true;
      firstResponse.statusCode = 201;
      firstResponse.setHeader('content-type', 'application/json');
      firstResponse.end('{"created":true}');
    });
    await flushPromises();

    expect(firstNextCalled).toBe(true);
    expect(redis.values.has(`idempotency:${IDEMPOTENCY_KEY}`)).toBe(true);
    expect(redis.ttlSeconds).toBe(86_400);

    const secondResponse = new FakeResponse();
    let secondNextCalled = false;
    await middleware.use(createRequest(IDEMPOTENCY_KEY), asServerResponse(secondResponse), () => {
      secondNextCalled = true;
    });

    expect(secondNextCalled).toBe(false);
    expect(secondResponse.statusCode).toBe(201);
    expect(secondResponse.getHeader('x-idempotent-replayed')).toBe('true');
    expect(secondResponse.getHeader('content-type')).toBe('application/json');
    expect(secondResponse.body).toBe('{"created":true}');
  });

  it('passes through without idempotency when no key is present', async () => {
    const redis = new MapRedisStore();
    const middleware = new IdempotencyMiddleware(redis);
    const response = new FakeResponse();
    let nextCalled = false;

    await middleware.use(createRequest(), asServerResponse(response), () => {
      nextCalled = true;
      response.end('ok');
    });
    await flushPromises();

    expect(nextCalled).toBe(true);
    expect(redis.values.size).toBe(0);
  });

  it('passes through invalid idempotency key formats', async () => {
    const redis = new MapRedisStore();
    const middleware = new IdempotencyMiddleware(redis);
    const response = new FakeResponse();
    let nextCalled = false;

    await middleware.use(createRequest('not-a-uuid'), asServerResponse(response), () => {
      nextCalled = true;
      response.end('ok');
    });
    await flushPromises();

    expect(nextCalled).toBe(true);
    expect(redis.values.size).toBe(0);
  });
});

function createRequest(idempotencyKey?: string): IncomingMessage {
  return {
    headers:
      idempotencyKey === undefined
        ? {}
        : {
            'x-idempotency-key': idempotencyKey,
          },
  } as IncomingMessage;
}

function asServerResponse(response: FakeResponse): ServerResponse {
  return response as unknown as ServerResponse;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
}
