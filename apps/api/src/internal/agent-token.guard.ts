import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';
import * as crypto from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import { getApiLogger } from '../common/logger/logger.module.js';

export type AgentAuthenticatedRequest = RequestLike & {
  agent?: {
    authenticated: true;
    auth_method: 'static';
  };
};

type RequestLike = {
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  raw?: {
    headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  };
};

@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor() {
    if (typeof process.env.CHERRY_AGENT_TOKEN !== 'string' || process.env.CHERRY_AGENT_TOKEN.length === 0) {
      getApiLogger().warn(
        { cherry_agent_token_present: false },
        'CHERRY_AGENT_TOKEN is not configured; internal Agent wiki endpoints will reject all requests',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AgentAuthenticatedRequest>();
    const expectedToken = process.env.CHERRY_AGENT_TOKEN;
    const providedToken = parseBearerToken(getHeaderValue(request, 'authorization'));

    if (
      typeof expectedToken !== 'string' ||
      expectedToken.length === 0 ||
      !hasMatchingAgentToken(expectedToken, providedToken)
    ) {
      throw new HttpException(
        {
          code: ErrorCode.UNAUTHENTICATED,
          message: 'Invalid Agent token',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    request.agent = {
      authenticated: true,
      auth_method: 'static',
    };

    return true;
  }
}

function getHeaderValue(request: RequestLike, name: string): string | undefined {
  return getHeaderFromRecord(request.headers, name) ?? getHeaderFromRecord(request.raw?.headers, name);
}

function getHeaderFromRecord(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (headers === undefined) {
    return undefined;
  }

  const normalizedName = name.toLowerCase();
  const directValue = normalizeHeaderValue(headers[name] ?? headers[normalizedName]);
  if (directValue !== undefined) {
    return directValue;
  }

  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerName.toLowerCase() === normalizedName) {
      return normalizeHeaderValue(headerValue);
    }
  }

  return undefined;
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

function parseBearerToken(authorization: string | undefined): string | undefined {
  if (authorization === undefined) {
    return undefined;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0) {
    return undefined;
  }

  return token;
}

function hasMatchingAgentToken(expectedToken: string, providedToken: string | undefined): boolean {
  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(providedToken ?? '');
  const normalizedProvidedBuffer =
    providedBuffer.length === expectedBuffer.length ? providedBuffer : Buffer.alloc(expectedBuffer.length);
  const tokensMatch = crypto.timingSafeEqual(expectedBuffer, normalizedProvidedBuffer);

  return providedBuffer.length === expectedBuffer.length && tokensMatch;
}
