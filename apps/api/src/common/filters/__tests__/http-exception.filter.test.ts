import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Module,
  NotFoundException,
  Post,
  RequestMethod,
} from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ErrorCode } from '@cherrygraph/shared';
import { IsString, ValidationError } from 'class-validator';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { configureApp } from '../../../main.js';
import { validationErrorsToDetails } from '../http-exception.filter.js';
import { RequestContextMiddleware } from '../../middleware/request-context.middleware.js';

const REQUEST_ID = 'filter-test-request-id';

class ValidationTestDto {
  @IsString()
  name!: string;
}

@Controller('error-test')
class ErrorTestController {
  @Get('not-found')
  notFound(): never {
    throw new NotFoundException('Missing resource');
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException('Access denied');
  }

  @Get('unknown')
  unknown(): never {
    throw new Error('secret implementation detail');
  }

  @Post('validation')
  validation(@Body() body: ValidationTestDto): { name: string } {
    return body;
  }
}

@Module({
  controllers: [ErrorTestController],
})
class ErrorTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}

let app: NestFastifyApplication | undefined;

describe('HttpExceptionFilter', () => {
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('maps HttpException 404 to NOT_FOUND response format', async () => {
    app = await createTestApp();
    const response = await request(app.getHttpAdapter().getInstance().server)
      .get('/api/error-test/not-found')
      .set('X-Request-Id', REQUEST_ID)
      .expect(404);

    const error = getErrorPayload(response.text);
    expect(error.code).toBe(ErrorCode.NOT_FOUND);
    expect(error.message).toBe('Missing resource');
    expect(getMetaPayload(response.text).request_id).toBe(REQUEST_ID);
  });

  it('maps HttpException 403 to PERMISSION_DENIED response format', async () => {
    app = await createTestApp();
    const response = await request(app.getHttpAdapter().getInstance().server)
      .get('/api/error-test/forbidden')
      .set('X-Request-Id', REQUEST_ID)
      .expect(403);

    const error = getErrorPayload(response.text);
    expect(error.code).toBe(ErrorCode.PERMISSION_DENIED);
    expect(error.message).toBe('Access denied');
    expect(getMetaPayload(response.text).request_id).toBe(REQUEST_ID);
  });

  it('maps unknown exceptions to INTERNAL_ERROR without leaking stack details', async () => {
    app = await createTestApp();
    const response = await request(app.getHttpAdapter().getInstance().server)
      .get('/api/error-test/unknown')
      .set('X-Request-Id', REQUEST_ID)
      .expect(500);

    const error = getErrorPayload(response.text);
    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(error.message).toBe('Internal server error');
    expect(getMetaPayload(response.text).request_id).toBe(REQUEST_ID);
    expect(response.text).not.toContain('secret implementation detail');
    expect(response.text).not.toContain('ErrorTestController');
  });

  it('maps validation failures to 422 VALIDATION_ERROR with details', async () => {
    app = await createTestApp();
    const response = await request(app.getHttpAdapter().getInstance().server)
      .post('/api/error-test/validation')
      .set('X-Request-Id', REQUEST_ID)
      .send({})
      .expect(422);

    const error = getErrorPayload(response.text);
    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error.message).toBe('Validation failed');
    expect(getMetaPayload(response.text).request_id).toBe(REQUEST_ID);
    expect(Array.isArray(error.details)).toBe(true);
    expect(Array.isArray(error.details) && error.details.length > 0).toBe(true);
  });

  it('includes request_id in all error responses', async () => {
    app = await createTestApp();
    const fastify = app.getHttpAdapter().getInstance();
    const cases = [
      request(fastify.server).get('/api/error-test/not-found').set('X-Request-Id', REQUEST_ID).expect(404),
      request(fastify.server).get('/api/error-test/forbidden').set('X-Request-Id', REQUEST_ID).expect(403),
      request(fastify.server).get('/api/error-test/unknown').set('X-Request-Id', REQUEST_ID).expect(500),
    ];

    const responses = await Promise.all(cases);
    for (const response of responses) {
      expect(getMetaPayload(response.text).request_id).toBe(REQUEST_ID);
    }
  });

  it('formats unmatched routes with the unified NOT_FOUND error response', async () => {
    app = await createTestApp();
    const response = await request(app.getHttpAdapter().getInstance().server)
      .get('/api/error-test/missing-route')
      .set('X-Request-Id', REQUEST_ID)
      .expect(404);

    const error = getErrorPayload(response.text);
    expect(error.code).toBe(ErrorCode.NOT_FOUND);
    expect(getMetaPayload(response.text).request_id).toBe(REQUEST_ID);
  });

  it('stops validation error detail recursion at the depth limit', () => {
    const details = validationErrorsToDetails([createNestedValidationError(5)], 2);
    const root = requireDetail(details[0]);
    const child = requireDetail(root.children?.[0]);
    const grandchild = requireDetail(child.children?.[0]);

    expect(root.property).toBe('level-0');
    expect(child.property).toBe('level-1');
    expect(grandchild.property).toBe('level-2');
    expect(grandchild.children).toBeUndefined();
  });
});

async function createTestApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [ErrorTestModule],
  }).compile();
  const testApp = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
  configureApp(testApp);
  await testApp.init();
  await testApp.getHttpAdapter().getInstance().ready();
  return testApp;
}

function getErrorPayload(text: string): Record<string, unknown> {
  const body = parseJsonObject(text);
  const error = body.error;
  if (!isRecord(error)) {
    throw new Error('Expected error payload');
  }

  return error;
}

function getMetaPayload(text: string): Record<string, unknown> {
  const body = parseJsonObject(text);
  const meta = body.meta;
  if (!isRecord(meta)) {
    throw new Error('Expected meta payload');
  }

  return meta;
}

function createNestedValidationError(maxLevel: number, currentLevel = 0): ValidationError {
  const error = new ValidationError();
  error.property = `level-${currentLevel}`;

  if (currentLevel < maxLevel) {
    error.children = [createNestedValidationError(maxLevel, currentLevel + 1)];
  }

  return error;
}

function requireDetail<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected validation error detail');
  }

  return value;
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
