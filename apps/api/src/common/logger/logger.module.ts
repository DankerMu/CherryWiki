import { Inject, Injectable, Module, Optional, type LoggerService, type NestMiddleware } from '@nestjs/common';
import type { RequestContext } from '@cherrygraph/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pino, { type Logger } from 'pino';
import { pinoHttp } from 'pino-http';

import { getRequestContext, getRequestIdFromRequest } from '../middleware/request-context.middleware.js';

type PinoLogMethod = (object: Record<string, unknown>, message: string) => void;

export const API_LOGGER = Symbol('API_LOGGER');

function createPinoLogger(): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: null,
  });
}

const apiLogger = createPinoLogger();

export function getApiLogger(): Logger {
  return apiLogger;
}

export function createNestLogger(logger: Logger = apiLogger): LoggerService {
  return {
    log(message: unknown, ...optionalParams: unknown[]): void {
      logger.info({ context: getContext(optionalParams) }, stringifyMessage(message));
    },
    error(message: unknown, ...optionalParams: unknown[]): void {
      logger.error({ context: getContext(optionalParams) }, stringifyMessage(message));
    },
    warn(message: unknown, ...optionalParams: unknown[]): void {
      logger.warn({ context: getContext(optionalParams) }, stringifyMessage(message));
    },
    debug(message: unknown, ...optionalParams: unknown[]): void {
      logger.debug({ context: getContext(optionalParams) }, stringifyMessage(message));
    },
    verbose(message: unknown, ...optionalParams: unknown[]): void {
      logger.trace({ context: getContext(optionalParams) }, stringifyMessage(message));
    },
  };
}

@Injectable()
export class PinoHttpLoggerMiddleware implements NestMiddleware {
  private readonly logger: Logger;
  private readonly httpLogger: ReturnType<typeof pinoHttp>;

  constructor(@Optional() @Inject(API_LOGGER) logger?: Logger) {
    this.logger = logger ?? apiLogger;
    this.httpLogger = pinoHttp({
      logger: this.logger,
      autoLogging: false,
    });
  }

  use(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const startedAt = process.hrtime.bigint();
    this.httpLogger(req, res);

    res.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const context = getRequestContext();
      const logObject = createRequestLogObject(req, res, durationMs, context);
      getLogMethod(this.logger, res.statusCode)(logObject, 'request completed');
    });

    next();
  }
}

@Module({
  providers: [{ provide: API_LOGGER, useValue: apiLogger }, PinoHttpLoggerMiddleware],
  exports: [API_LOGGER, PinoHttpLoggerMiddleware],
})
export class LoggerModule {}

function createRequestLogObject(
  req: IncomingMessage,
  res: ServerResponse,
  durationMs: number,
  context: RequestContext | undefined,
): Record<string, unknown> {
  return {
    request_id: context?.request_id ?? getRequestIdFromRequest(req) ?? '',
    tenant_id: context?.tenant_id ?? '',
    user_id: context?.user_id ?? null,
    space_id: context?.space_id ?? null,
    method: req.method ?? '',
    url: stripQueryString(req.url ?? ''),
    status_code: res.statusCode,
    duration_ms: Math.round(durationMs),
  };
}

function getLogMethod(logger: Logger, statusCode: number): PinoLogMethod {
  if (statusCode >= 500) {
    return logger.error.bind(logger);
  }

  if (statusCode >= 400) {
    return logger.warn.bind(logger);
  }

  return logger.info.bind(logger);
}

function stringifyMessage(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }

  if (message instanceof Error) {
    return message.message;
  }

  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

function stripQueryString(url: string): string {
  const idx = url.indexOf('?');
  return idx === -1 ? url : url.slice(0, idx);
}

function getContext(optionalParams: unknown[]): string | undefined {
  const lastParam = optionalParams.at(-1);
  return typeof lastParam === 'string' ? lastParam : undefined;
}
