import { Controller, Get, Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { configureApp } from '../../../main.js';
import {
  getRequestContext,
  RESPONSE_REQUEST_ID_HEADER,
  RequestContextMiddleware,
} from '../request-context.middleware.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('context-test')
class ContextTestController {
  @Get()
  getContext(): { request_id: string | null } {
    return {
      request_id: getRequestContext()?.request_id ?? null,
    };
  }
}

@Module({
  controllers: [ContextTestController],
})
class ContextTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}

let app: NestFastifyApplication | undefined;

describe('RequestContextMiddleware', () => {
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('auto-generates a UUID v4 request_id when X-Request-Id is absent', async () => {
    app = await createTestApp();
    const response = await request(app.getHttpAdapter().getInstance().server).get('/api/context-test').expect(200);

    const requestId = getHeader(response.headers, 'x-request-id');
    expect(requestId).toMatch(UUID_V4_PATTERN);
    expect(parseJsonObject(response.text).request_id).toBe(requestId);
  });

  it('uses the provided X-Request-Id header value', async () => {
    app = await createTestApp();
    const providedRequestId = 'provided-request-id';
    const response = await request(app.getHttpAdapter().getInstance().server)
      .get('/api/context-test')
      .set('X-Request-Id', providedRequestId)
      .expect(200);

    expect(getHeader(response.headers, 'x-request-id')).toBe(providedRequestId);
    expect(parseJsonObject(response.text).request_id).toBe(providedRequestId);
  });

  it('rejects oversized X-Request-Id values and generates a fresh UUID', () => {
    const oversizedRequestId = 'a'.repeat(129);
    const result = runMiddlewareWithRequestId(oversizedRequestId);

    expect(result.requestId).toMatch(UUID_V4_PATTERN);
    expect(result.requestId).not.toBe(oversizedRequestId);
  });

  it('rejects X-Request-Id values containing control characters', () => {
    const result = runMiddlewareWithRequestId('request\tid');

    expect(result.requestId).toMatch(UUID_V4_PATTERN);
  });

  it('rejects X-Request-Id values containing special characters such as newlines', () => {
    const result = runMiddlewareWithRequestId('request\nid');

    expect(result.requestId).toMatch(UUID_V4_PATTERN);
  });

  it('returns request_id in the X-Request-Id response header', async () => {
    app = await createTestApp();
    const response = await request(app.getHttpAdapter().getInstance().server).get('/api/context-test').expect(200);

    expect(typeof getHeader(response.headers, 'x-request-id')).toBe('string');
  });
});

async function createTestApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [ContextTestModule],
  }).compile();
  const testApp = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
  configureApp(testApp);
  await testApp.init();
  await testApp.getHttpAdapter().getInstance().ready();
  return testApp;
}

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

type MiddlewareRequest = IncomingMessage & {
  request_id?: string;
  raw?: {
    request_id?: string;
    headers?: IncomingHttpHeaders;
  };
};

function runMiddlewareWithRequestId(headerValue: string): { requestId: string; responseHeader: string } {
  const headers: IncomingHttpHeaders = {
    'x-request-id': headerValue,
  };
  const req = {
    headers,
    raw: {
      headers,
    },
  } as MiddlewareRequest;
  const responseHeaders = new Map<string, string>();
  const res = {
    setHeader(name: string, value: number | string | string[]): ServerResponse {
      responseHeaders.set(name.toLowerCase(), Array.isArray(value) ? (value[0] ?? '') : String(value));
      return res;
    },
  } as ServerResponse;
  let contextRequestId: string | null = null;

  new RequestContextMiddleware().use(req, res, () => {
    contextRequestId = getRequestContext()?.request_id ?? null;
  });

  const responseHeader = responseHeaders.get(RESPONSE_REQUEST_ID_HEADER.toLowerCase()) ?? '';
  expect(req.request_id).toBe(responseHeader);
  expect(req.raw?.request_id).toBe(responseHeader);
  expect(contextRequestId).toBe(responseHeader);

  return {
    requestId: req.request_id ?? '',
    responseHeader,
  };
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Expected a JSON object');
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
