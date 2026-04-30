import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';
import type { IncomingHttpHeaders } from 'node:http';

type RequestLike = {
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  raw?: {
    headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  };
};

@Injectable()
export class WorkerApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const expectedKey = process.env.WORKER_API_KEY;
    const providedKey = getHeaderValue(request, 'x-worker-key');

    if (typeof expectedKey !== 'string' || expectedKey.length === 0 || providedKey !== expectedKey) {
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
