import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';

import { IdempotencyMiddleware, type IdempotencyRedisStore } from '../idempotency.middleware.js';

const IDEMPOTENCY_KEY = '123e4567-e89b-42d3-a456-426614174000';

class MapRedisStore implements IdempotencyRedisStore {
  readonly values = new Map<string, string>();
  readonly ttlSeconds = new Map<string, number>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, condition: 'NX', expirationMode: 'EX', seconds: number): Promise<'OK' | null> {
    expect(condition).toBe('NX');
    expect(expirationMode).toBe('EX');

    if (this.values.has(key)) {
      return Promise.resolve(null);
    }

    this.values.set(key, value);
    this.ttlSeconds.set(key, seconds);
    return Promise.resolve('OK');
  }

  setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.ttlSeconds.set(key, seconds);
    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  del(key: string): Promise<number> {
    const deleted = this.values.delete(key);
    this.ttlSeconds.delete(key);
    return Promise.resolve(deleted ? 1 : 0);
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
  it('stores the first response and replays the second response for the same scoped key', async () => {
    const redis = new MapRedisStore();
    const middleware = new IdempotencyMiddleware(redis);
    const redisKey = scopedRedisKey('/widgets');
    const firstResponse = new FakeResponse();
    let firstNextCalled = false;

    await middleware.use(createRequest({ idempotencyKey: IDEMPOTENCY_KEY, url: '/widgets' }), asServerResponse(firstResponse), () => {
      firstNextCalled = true;
      firstResponse.statusCode = 201;
      firstResponse.setHeader('content-type', 'application/json; charset=utf-8');
      firstResponse.end('{"created":true}');
    });
    await flushPromises();

    expect(firstNextCalled).toBe(true);
    expect(redis.values.has(redisKey)).toBe(true);
    expect(redis.ttlSeconds.get(redisKey)).toBe(86_400);

    const secondResponse = new FakeResponse();
    let secondNextCalled = false;
    await middleware.use(createRequest({ idempotencyKey: IDEMPOTENCY_KEY, url: '/widgets' }), asServerResponse(secondResponse), () => {
      secondNextCalled = true;
    });

    expect(secondNextCalled).toBe(false);
    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.getHeader('x-idempotent-replayed')).toBe('true');
    expect(secondResponse.getHeader('content-type')).toBe('application/json; charset=utf-8');
    expect(secondResponse.body).toBe('{"created":true}');
  });

  it('keeps the same idempotency key independent across different paths', async () => {
    const redis = new MapRedisStore();
    const middleware = new IdempotencyMiddleware(redis);

    const firstResponse = new FakeResponse();
    await middleware.use(createRequest({ idempotencyKey: IDEMPOTENCY_KEY, url: '/alpha' }), asServerResponse(firstResponse), () => {
      firstResponse.setHeader('content-type', 'application/json');
      firstResponse.end('{"path":"alpha"}');
    });

    const secondResponse = new FakeResponse();
    let secondNextCalled = false;
    await middleware.use(createRequest({ idempotencyKey: IDEMPOTENCY_KEY, url: '/beta' }), asServerResponse(secondResponse), () => {
      secondNextCalled = true;
      secondResponse.setHeader('content-type', 'application/json');
      secondResponse.end('{"path":"beta"}');
    });

    const replayResponse = new FakeResponse();
    await middleware.use(createRequest({ idempotencyKey: IDEMPOTENCY_KEY, url: '/alpha' }), asServerResponse(replayResponse), () => {
      throw new Error('Expected alpha response to replay');
    });

    expect(secondNextCalled).toBe(true);
    expect(redis.values.has(scopedRedisKey('/alpha'))).toBe(true);
    expect(redis.values.has(scopedRedisKey('/beta'))).toBe(true);
    expect(replayResponse.body).toBe('{"path":"alpha"}');
  });

  it('reserves the key atomically and rejects concurrent processing requests', async () => {
    const redis = new MapRedisStore();
    const middleware = new IdempotencyMiddleware(redis);
    const redisKey = scopedRedisKey('/slow');
    const firstResponse = new FakeResponse();
    let firstNextCalled = false;

    await middleware.use(createRequest({ idempotencyKey: IDEMPOTENCY_KEY, url: '/slow' }), asServerResponse(firstResponse), () => {
      firstNextCalled = true;
    });

    expect(firstNextCalled).toBe(true);
    expect(redis.values.get(redisKey)).toBe('processing');
    expect(redis.ttlSeconds.get(redisKey)).toBe(300);

    const secondResponse = new FakeResponse();
    let secondNextCalled = false;
    await middleware.use(createRequest({ idempotencyKey: IDEMPOTENCY_KEY, url: '/slow' }), asServerResponse(secondResponse), () => {
      secondNextCalled = true;
    });

    expect(secondNextCalled).toBe(false);
    expect(secondResponse.statusCode).toBe(409);
    expect(secondResponse.getHeader('content-type')).toBe('application/json');
  });

  it('does not cache responses exceeding the response size limit', async () => {
    const redis = new MapRedisStore();
    const middleware = new IdempotencyMiddleware(redis);
    const redisKey = scopedRedisKey('/large');
    const response = new FakeResponse();

    await middleware.use(createRequest({ idempotencyKey: IDEMPOTENCY_KEY, url: '/large' }), asServerResponse(response), () => {
      response.setHeader('content-type', 'application/json');
      response.end(Buffer.alloc(1_048_577, 65));
    });
    await flushPromises();

    expect(redis.values.has(redisKey)).toBe(false);
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

    await middleware.use(createRequest({ idempotencyKey: 'not-a-uuid' }), asServerResponse(response), () => {
      nextCalled = true;
      response.end('ok');
    });
    await flushPromises();

    expect(nextCalled).toBe(true);
    expect(redis.values.size).toBe(0);
  });
});

type RequestOptions = {
  idempotencyKey?: string;
  method?: string;
  url?: string;
};

function createRequest(options: RequestOptions = {}): IncomingMessage {
  const headers =
    options.idempotencyKey === undefined
      ? {}
      : {
          'x-idempotency-key': options.idempotencyKey,
        };

  return {
    headers,
    method: options.method ?? 'POST',
    url: options.url ?? '/widgets',
  } as IncomingMessage;
}

function scopedRedisKey(path: string, method = 'POST'): string {
  return `idempotency:${method}:${path}:anon:${IDEMPOTENCY_KEY}`;
}

function asServerResponse(response: FakeResponse): ServerResponse {
  return response as unknown as ServerResponse;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
}
