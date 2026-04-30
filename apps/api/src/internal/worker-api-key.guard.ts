import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';
import * as crypto from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import { getApiLogger } from '../common/logger/logger.module.js';

type RequestLike = {
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  raw?: {
    headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  };
};

@Injectable()
export class WorkerApiKeyGuard implements CanActivate {
  constructor() {
    if (typeof process.env.WORKER_API_KEY !== 'string' || process.env.WORKER_API_KEY.length === 0) {
      getApiLogger().warn(
        { worker_api_key_present: false },
        'WORKER_API_KEY is not configured; internal worker endpoints will reject all requests',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const expectedKey = process.env.WORKER_API_KEY;
    const providedKey = getHeaderValue(request, 'x-worker-key');

    if (typeof expectedKey !== 'string' || expectedKey.length === 0 || !hasMatchingWorkerApiKey(expectedKey, providedKey)) {
      throw new HttpException(
        {
          code: ErrorCode.UNAUTHENTICATED,
          message: 'Invalid worker API key',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    return true;
  }
}

function getHeaderValue(request: RequestLike, name: string): string | undefined {
  const directValue = normalizeHeaderValue(request.headers?.[name]);
  if (directValue !== undefined) {
    return directValue;
  }

  return normalizeHeaderValue(request.raw?.headers?.[name]);
}

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
    return first?.trim();
  }

  return undefined;
}

function hasMatchingWorkerApiKey(expectedKey: string, providedKey: string | undefined): boolean {
  const expectedBuffer = Buffer.from(expectedKey);
  const providedBuffer = Buffer.from(providedKey ?? '');
  const normalizedProvidedBuffer =
    providedBuffer.length === expectedBuffer.length ? providedBuffer : Buffer.alloc(expectedBuffer.length);
  const keysMatch = crypto.timingSafeEqual(expectedBuffer, normalizedProvidedBuffer);

  return providedBuffer.length === expectedBuffer.length && keysMatch;
}
