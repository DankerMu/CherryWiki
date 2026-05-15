import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Public, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { IncomingHttpHeaders } from 'node:http';

import { RateLimit } from '../common/guards/rate-limit.guard.js';
import { getRequestIdFromRequest } from '../common/middleware/request-context.middleware.js';
import {
  AuthService,
  type AuthRequestMetadata,
  type LoginResponse,
  type TokenPairResponse,
} from './auth.service.js';
import { SessionService, type SessionSummary } from './session.service.js';

class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  current_password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  new_password!: string;
}

type RequestWithAuth = {
  user?: AuthenticatedRequestUser;
  headers?: IncomingHttpHeaders;
  cookies?: Record<string, string | undefined>;
  ip?: string;
  request_id?: string;
  raw?: {
    headers?: IncomingHttpHeaders;
    ip?: string;
    request_id?: string;
    socket?: {
      remoteAddress?: string;
    };
  };
  socket?: {
    remoteAddress?: string;
  };
};

type CookieResponse = {
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
  raw?: {
    setHeader?: (name: string, value: string) => unknown;
  };
};

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
  ) {}

  @Public()
  @RateLimit(10, 60, 'ip')
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(body, getRequestMetadata(request));
    setRefreshCookie(response, result.refreshToken);
    return toLoginResponse(result);
  }

  @Public()
  @RateLimit(30, 60, 'ip')
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<TokenPairResponse> {
    const refreshToken = getRefreshTokenCookie(request);
    if (refreshToken === undefined) {
      throw new HttpException(
        {
          code: ErrorCode.INVALID_REFRESH_TOKEN,
          message: 'Refresh token cookie is required',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const result = await this.authService.refresh(refreshToken, getRequestMetadata(request));
    setRefreshCookie(response, result.refreshToken);
    return toTokenPairResponse(result);
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ success: true }> {
    try {
      return await this.authService.logout(
        getAuthenticatedUser(request),
        { refreshToken: getRefreshTokenCookie(request) },
        getRequestMetadata(request),
      );
    } finally {
      clearRefreshCookie(response);
    }
  }

  @Get('me')
  async me(
    @Req() request: RequestWithAuth,
  ): Promise<Awaited<ReturnType<AuthService['getCurrentUser']>>> {
    return this.authService.getCurrentUser(getAuthenticatedUser(request));
  }

  @HttpCode(HttpStatus.OK)
  @Post('password/change')
  async changePassword(
    @Body() body: ChangePasswordDto,
    @Req() request: RequestWithAuth,
  ): Promise<{ success: true }> {
    return this.authService.changePassword(
      getAuthenticatedUser(request),
      body,
      getRequestMetadata(request),
    );
  }

  @Get('sessions')
  async listSessions(@Req() request: RequestWithAuth): Promise<SessionSummary[]> {
    const user = getAuthenticatedUser(request);
    return this.sessionService.listActiveSessions({
      tenantId: user.tenant_id,
      userId: user.sub,
      ...(user.session_id !== undefined ? { currentSessionId: user.session_id } : {}),
    });
  }

  @Delete('sessions/:session_id')
  async revokeSession(
    @Param('session_id') sessionId: string,
    @Req() request: RequestWithAuth,
  ): Promise<{ revoked: true }> {
    const user = getAuthenticatedUser(request);
    return this.sessionService.revokeSession({
      tenantId: user.tenant_id,
      userId: user.sub,
      sessionId,
      metadata: getRequestMetadata(request),
    });
  }
}

function toLoginResponse(result: Awaited<ReturnType<AuthService['login']>>): LoginResponse {
  return {
    access_token: result.access_token,
    expires_in: result.expires_in,
    user: result.user,
  };
}

function toTokenPairResponse(result: Awaited<ReturnType<AuthService['refresh']>>): TokenPairResponse {
  return {
    access_token: result.access_token,
    expires_in: result.expires_in,
  };
}

function getAuthenticatedUser(request: RequestWithAuth): AuthenticatedRequestUser {
  if (request.user === undefined) {
    throw new HttpException(
      {
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Unauthenticated',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }

  return request.user;
}

function getRequestMetadata(request: RequestWithAuth): AuthRequestMetadata {
  const ip = getRequestIp(request);
  const userAgent = getUserAgent(request);
  const requestId = getRequestIdFromRequest(request);

  return {
    ...(ip !== undefined ? { ip } : {}),
    ...(userAgent !== undefined ? { user_agent: userAgent } : {}),
    ...(requestId !== undefined ? { request_id: requestId } : {}),
  };
}

function setRefreshCookie(response: CookieResponse, refreshToken: string): void {
  const securePart = isCookieSecure() ? '; Secure' : '';
  setResponseHeader(
    response,
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}; Max-Age=${REFRESH_COOKIE_MAX_AGE_SECONDS}; Path=/api/auth; HttpOnly${securePart}; SameSite=Lax`,
  );
}

function clearRefreshCookie(response: CookieResponse): void {
  const securePart = isCookieSecure() ? '; Secure' : '';
  setResponseHeader(
    response,
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=; Max-Age=0; Path=/api/auth; HttpOnly${securePart}; SameSite=Lax`,
  );
}

function isCookieSecure(): boolean {
  return process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production';
}

function getRefreshTokenCookie(request: RequestWithAuth): string | undefined {
  if (countCookieHeaderEntries(request, REFRESH_COOKIE_NAME) > 1) {
    throw new UnauthorizedException({
      code: ErrorCode.INVALID_REFRESH_TOKEN,
      message: 'Multiple refresh token cookies are not allowed',
    });
  }

  const cookieValue = request.cookies?.[REFRESH_COOKIE_NAME] ?? parseCookieHeader(request)[REFRESH_COOKIE_NAME];
  if (cookieValue === undefined || cookieValue.trim().length === 0) {
    return undefined;
  }

  return cookieValue;
}

function countCookieHeaderEntries(request: RequestWithAuth, cookieName: string): number {
  const header = (request.headers ?? request.raw?.headers)?.cookie;
  const rawCookie = Array.isArray(header) ? header.join(';') : header;
  if (typeof rawCookie !== 'string' || rawCookie.trim().length === 0) {
    return 0;
  }

  let count = 0;
  for (const part of rawCookie.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    if (part.slice(0, separatorIndex).trim() === cookieName) {
      count += 1;
    }
  }

  return count;
}

function parseCookieHeader(request: RequestWithAuth): Record<string, string> {
  const header = (request.headers ?? request.raw?.headers)?.cookie;
  const rawCookie = Array.isArray(header) ? header.join(';') : header;
  if (typeof rawCookie !== 'string' || rawCookie.trim().length === 0) {
    return {};
  }

  const cookies: Record<string, string> = {};
  for (const part of rawCookie.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const name = part.slice(0, separatorIndex).trim();
    const rawValue = part.slice(separatorIndex + 1).trim();
    if (name.length === 0 || name in cookies) {
      continue;
    }

    cookies[name] = safeDecodeURIComponent(rawValue);
  }

  return cookies;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function setResponseHeader(response: CookieResponse, name: string, value: string): void {
  if (typeof response.header === 'function') {
    response.header(name, value);
    return;
  }

  if (typeof response.setHeader === 'function') {
    response.setHeader(name, value);
    return;
  }

  response.raw?.setHeader?.(name, value);
}

function getRequestIp(request: RequestWithAuth): string | undefined {
  return (
    request.ip ??
    request.raw?.ip ??
    request.socket?.remoteAddress ??
    request.raw?.socket?.remoteAddress
  );
}

function getUserAgent(request: RequestWithAuth): string | undefined {
  const value = (request.headers ?? request.raw?.headers)?.['user-agent'];
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === 'string' ? firstValue : undefined;
  }

  return undefined;
}
