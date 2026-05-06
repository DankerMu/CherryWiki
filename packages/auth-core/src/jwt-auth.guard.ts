import { Inject, Injectable, Optional, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@cherrygraph/shared';

import type { VerifiedAccessTokenPayload } from './jwt.js';
import { verifyAccessToken } from './jwt.js';
import { PUBLIC_METADATA_KEY } from './public.decorator.js';

export const AUTH_CORE_OPTIONS = Symbol('AUTH_CORE_OPTIONS');

export type AuthCoreOptions = {
  jwtSecret?: string;
  accessTokenSecret?: string;
  getJwtSecret?: () => string | Promise<string>;
};

export type AuthenticatedRequestUser = VerifiedAccessTokenPayload & {
  iat?: number;
  exp?: number;
};

type RequestWithUser = {
  headers?: Record<string, string | string[] | undefined>;
  user?: AuthenticatedRequestUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(AUTH_CORE_OPTIONS) private readonly options?: AuthCoreOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.user !== undefined) {
      return true;
    }

    const token = getBearerToken(request);
    if (token === undefined) {
      throwUnauthenticated();
    }

    try {
      request.user = await verifyAccessToken(token, await this.resolveJwtSecret());
      return true;
    } catch {
      throwUnauthenticated();
    }
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, [context.getHandler(), context.getClass()]) ===
      true
    );
  }

  private async resolveJwtSecret(): Promise<string> {
    const secret = this.options?.getJwtSecret
      ? await this.options.getJwtSecret()
      : (this.options?.accessTokenSecret ?? this.options?.jwtSecret ?? process.env.JWT_SECRET);

    if (secret === undefined || secret.length === 0) {
      throwUnauthenticated();
    }

    return secret;
  }
}

function getBearerToken(request: RequestWithUser): string | undefined {
  const authorization = getAuthorizationHeader(request);
  if (authorization === undefined) {
    return undefined;
  }

  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0 || extra !== undefined) {
    return undefined;
  }

  return token;
}

function getAuthorizationHeader(request: RequestWithUser): string | undefined {
  const headerValue = request.headers?.authorization ?? request.headers?.Authorization;
  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }

  return headerValue;
}

function throwUnauthenticated(): never {
  throw new UnauthorizedException({
    code: ErrorCode.UNAUTHENTICATED,
    message: 'Unauthenticated',
  });
}
