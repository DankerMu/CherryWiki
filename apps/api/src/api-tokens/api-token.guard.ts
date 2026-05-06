import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_METADATA_KEY } from '@cherrygraph/auth-core';
import type { IncomingHttpHeaders } from 'node:http';

import { ApiTokenService, type ApiTokenAuthenticatedUser } from './api-token.service.js';

type RequestWithAuth = {
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  raw?: {
    headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  };
  user?: ApiTokenAuthenticatedUser;
};

const API_TOKEN_PREFIX = 'cwt_';

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(
    private readonly apiTokenService: ApiTokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = getBearerToken(request);
    if (token === undefined || !token.startsWith(API_TOKEN_PREFIX)) {
      return true;
    }

    request.user = await this.apiTokenService.authenticateRawToken(token);
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, [context.getHandler(), context.getClass()]) ===
      true
    );
  }
}

function getBearerToken(request: RequestWithAuth): string | undefined {
  const authorization = getHeaderValue(request, 'authorization');
  if (authorization === undefined) {
    return undefined;
  }

  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0 || extra !== undefined) {
    return undefined;
  }

  return token;
}

function getHeaderValue(request: RequestWithAuth, name: string): string | undefined {
  const normalizedName = name.toLowerCase();
  const directValue = normalizeHeaderValue(request.headers?.[normalizedName] ?? request.headers?.[name]);
  if (directValue !== undefined) {
    return directValue;
  }

  return normalizeHeaderValue(request.raw?.headers?.[normalizedName] ?? request.raw?.headers?.[name]);
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
