import { Controller, Get, Module, Param, RequestMethod, Res } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Writable } from 'node:stream';
import pino, { type Logger } from 'pino';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { RequestContextMiddleware } from '../../middleware/request-context.middleware.js';
import { API_LOGGER, createNestLogger, LoggerModule, PinoHttpLoggerMiddleware } from '../logger.module.js';

const REQUEST_ID = 'logger-test-request-id';

type ReplyLike = {
  status: (statusCode: number) => {
    send: (payload: Record<string, unknown>) => void;
  };
};

@Controller('logger-test')
class LoggerTestController {
  @Get(':statusCode')
  respond(@Param('statusCode') statusCode: string, @Res() reply: ReplyLike): void {
    const parsedStatusCode = Number(statusCode);
    reply.status(parsedStatusCode).send({ status_code: parsedStatusCode });
  }
}

@Module({
  imports: [LoggerModule],
  controllers: [LoggerTestController],
})
class LoggerTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware, PinoHttpLoggerMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}

let app: NestFastifyApplication | undefined;

describe('LoggerModule', () => {
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('writes JSON request logs with structured request fields', async () => {
    const capture = new LogCaptureStream();
    app = await createTestApp(createCapturedLogger(capture));

    await request(app.getHttpAdapter().getInstance().server)
      .get('/api/logger-test/200')
      .set('X-Request-Id', REQUEST_ID)
      .expect(200);

    const entry = getOnlyLogEntry(capture);
    expect(entry.request_id).toBe(REQUEST_ID);
    expect(entry.method).toBe('GET');
    expect(entry.url).toBe('/api/logger-test/200');
    expect(entry.status_code).toBe(200);
    expect(typeof entry.duration_ms).toBe('number');
  });

  it('routes request logs by status code severity', async () => {
    const capture = new LogCaptureStream();
    app = await createTestApp(createCapturedLogger(capture));
    const fastify = app.getHttpAdapter().getInstance();
    const cases = [
      { statusCode: 200, level: 30 },
      { statusCode: 404, level: 40 },
      { statusCode: 500, level: 50 },
    ];

    for (const testCase of cases) {
      capture.clear();
      await request(fastify.server)
        .get(`/api/logger-test/${testCase.statusCode}`)
        .set('X-Request-Id', REQUEST_ID)
        .expect(testCase.statusCode);

      expect(getOnlyLogEntry(capture).level).toBe(testCase.level);
    }
  });

  it('emits output from each NestLogger adapter method', () => {
    const capture = new LogCaptureStream();
    const nestLogger = createNestLogger(createCapturedLogger(capture));

    nestLogger.log('log message', 'TestContext');
    nestLogger.error('error message', 'TestContext');
    nestLogger.warn('warn message', 'TestContext');
    if (nestLogger.debug === undefined || nestLogger.verbose === undefined) {
      throw new Error('Expected debug and verbose logger methods');
    }

    nestLogger.debug('debug message', 'TestContext');
    nestLogger.verbose('verbose message', 'TestContext');

    const entries = capture.entries();
    expect(entries.map((entry) => entry.level)).toEqual([30, 50, 40, 20, 10]);
    expect(entries.map((entry) => entry.msg)).toEqual([
      'log message',
      'error message',
      'warn message',
      'debug message',
      'verbose message',
    ]);
    expect(entries.every((entry) => entry.context === 'TestContext')).toBe(true);
  });

  it('falls back to String(message) for circular NestLogger messages', () => {
    const capture = new LogCaptureStream();
    const nestLogger = createNestLogger(createCapturedLogger(capture));
    const circularMessage: Record<string, unknown> = {};
    circularMessage.self = circularMessage;

    expect(() => {
      nestLogger.log(circularMessage, 'TestContext');
    }).not.toThrow();
    expect(getOnlyLogEntry(capture).msg).toBe('[object Object]');
  });
});

async function createTestApp(logger: Logger): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [LoggerTestModule],
  })
    .overrideProvider(API_LOGGER)
    .useValue(logger)
    .compile();
  const testApp = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
  testApp.setGlobalPrefix('api');
  await testApp.init();
  await testApp.getHttpAdapter().getInstance().ready();
  return testApp;
}

class LogCaptureStream extends Writable {
  private readonly chunks: string[] = [];

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString('utf8'));
    callback();
  }

  entries(): Array<Record<string, unknown>> {
    return this.chunks
      .join('')
      .split('\n')
      .filter((line) => line.length > 0)
      .map(parseJsonObject);
  }

  clear(): void {
    this.chunks.length = 0;
  }
}

function createCapturedLogger(capture: LogCaptureStream): Logger {
  return pino(
    {
      base: null,
      level: 'trace',
      timestamp: false,
    },
    capture,
  );
}

function getOnlyLogEntry(capture: LogCaptureStream): Record<string, unknown> {
  const entries = capture.entries();
  expect(entries).toHaveLength(1);
  return requireValue(entries[0]);
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Expected a JSON object');
  }

  return parsed;
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected value');
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
