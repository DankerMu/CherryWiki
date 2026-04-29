import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { RequestContext } from '@cherrygraph/shared';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { v4 as uuidv4 } from 'uuid';

export const REQUEST_ID_HEADER = 'x-request-id';
export const RESPONSE_REQUEST_ID_HEADER = 'X-Request-Id';

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

type RequestWithContext = IncomingMessage & {
  request_id?: string;
  raw?: {
    request_id?: string;
    headers?: IncomingHttpHeaders;
  };
};

type HeaderCarrier = {
  headers?: IncomingHttpHeaders;
  raw?: {
    headers?: IncomingHttpHeaders;
  };
};

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function extractHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function getRequestIdFromRequest(request: unknown): string | undefined {
  if (!isRecord(request)) {
    return undefined;
  }

  const requestId = request.request_id;
  if (typeof requestId === 'string' && requestId.length > 0) {
    return requestId;
  }

  const raw = request.raw;
  if (isRecord(raw)) {
    const rawRequestId = raw.request_id;
    if (typeof rawRequestId === 'string' && rawRequestId.length > 0) {
      return rawRequestId;
    }
  }

  const headers = getHeaders(request);
  return extractHeaderValue(headers?.[REQUEST_ID_HEADER]);
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: RequestWithContext, res: ServerResponse, next: () => void): void {
    const requestId = extractHeaderValue(req.headers[REQUEST_ID_HEADER]) ?? uuidv4();
    const context: RequestContext = {
      request_id: requestId,
      tenant_id: '',
      user_id: null,
      space_id: null,
    };

    req.request_id = requestId;
    if (req.raw !== undefined) {
      req.raw.request_id = requestId;
    }

    res.setHeader(RESPONSE_REQUEST_ID_HEADER, requestId);
    requestContextStorage.run(context, next);
  }
}

function getHeaders(carrier: HeaderCarrier): IncomingHttpHeaders | undefined {
  return carrier.headers ?? carrier.raw?.headers;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}
