import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { isPaginatedResponse } from '../dto/pagination.dto.js';
import { getRequestContext, getRequestIdFromRequest } from '../middleware/request-context.middleware.js';

type WrappedResponse = {
  data: unknown;
  meta: {
    request_id: string;
    pagination?: unknown;
  };
};

type RequestLike = {
  url?: string;
  raw?: {
    url?: string;
  };
};

@Injectable()
export class ResponseWrapperInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    if (isHealthRequest(request) || isChatCompletionStreamRequest(request)) {
      return next.handle();
    }

    return next.handle().pipe(map((value) => wrapResponse(value, request)));
  }
}

function wrapResponse(value: unknown, request: RequestLike): WrappedResponse {
  const requestId = getRequestContext()?.request_id ?? getRequestIdFromRequest(request) ?? '';

  if (isPaginatedResponse(value)) {
    return {
      data: value.data,
      meta: {
        request_id: requestId,
        pagination: value.pagination,
      },
    };
  }

  return {
    data: value === undefined ? null : value,
    meta: {
      request_id: requestId,
    },
  };
}

function isHealthRequest(request: RequestLike): boolean {
  const url = request.url ?? request.raw?.url ?? '';
  const path = url.split('?')[0];
  return path === '/health' || path === '/health/' || path === '/api/health' || path === '/api/health/';
}

function isChatCompletionStreamRequest(request: RequestLike): boolean {
  const url = request.url ?? request.raw?.url ?? '';
  const path = url.split('?')[0];
  return (
    path === '/chat/completions' ||
    path === '/chat/completions/' ||
    path === '/api/chat/completions' ||
    path === '/api/chat/completions/'
  );
}
