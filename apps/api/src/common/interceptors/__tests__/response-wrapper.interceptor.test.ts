import { Controller, Get, Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { configureApp } from '../../../main.js';
import { buildPaginationMeta, paginatedResponse } from '../../dto/pagination.dto.js';
import { RequestContextMiddleware } from '../../middleware/request-context.middleware.js';

const REQUEST_ID = 'wrapper-test-request-id';

@Controller('wrapper-test')
class WrapperTestController {
  @Get()
  getValue(): { ok: true } {
    return { ok: true };
  }

  @Get('paginated')
  getPaginated(): ReturnType<typeof paginatedResponse<{ id: string }>> {
    return paginatedResponse([{ id: 'item-1' }], buildPaginationMeta(1, 20, 100));
  }
}

@Controller('internal')
class InternalTestController {
  @Get('wrapper-test')
  getValue(): { results: unknown[] } {
    return { results: [] };
  }
}

@Module({
  controllers: [WrapperTestController, InternalTestController],
})
class WrapperTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}

let app: NestFastifyApplication | undefined;

describe('ResponseWrapperInterceptor', () => {
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('wraps success responses in data and meta', async () => {
    app = await createTestApp();

    const response = await request(app.getHttpAdapter().getInstance().server)
      .get('/api/wrapper-test')
      .set('X-Request-Id', REQUEST_ID)
      .expect(200);

    expect(parseJsonObject(response.text)).toEqual({
      data: { ok: true },
      meta: { request_id: REQUEST_ID },
    });
  });

  it('includes pagination meta when controllers return a paginated response', async () => {
    app = await createTestApp();

    const response = await request(app.getHttpAdapter().getInstance().server)
      .get('/api/wrapper-test/paginated')
      .set('X-Request-Id', REQUEST_ID)
      .expect(200);

    expect(parseJsonObject(response.text)).toEqual({
      data: [{ id: 'item-1' }],
      meta: {
        request_id: REQUEST_ID,
        pagination: {
          page: 1,
          per_page: 20,
          total: 100,
          has_next: true,
        },
      },
    });
  });

  it('does not wrap internal endpoint responses', async () => {
    app = await createTestApp();

    const response = await request(app.getHttpAdapter().getInstance().server)
      .get('/api/internal/wrapper-test')
      .set('X-Request-Id', REQUEST_ID)
      .expect(200);

    expect(parseJsonObject(response.text)).toEqual({ results: [] });
  });
});

async function createTestApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [WrapperTestModule],
  }).compile();
  const testApp = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
  configureApp(testApp);
  await testApp.init();
  await testApp.getHttpAdapter().getInstance().ready();
  return testApp;
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
