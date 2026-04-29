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
} from '@nestjs/common';
import { Public, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { IncomingHttpHeaders } from 'node:http';

import { RateLimit } from '../common/guards/rate-limit.guard.js';
import { getRequestIdFromRequest } from '../common/middleware/request-context.middleware.js';
import { AuthService, type AuthRequestMetadata } from './auth.service.js';
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

class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refresh_token!: string;
}

class LogoutDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refresh_token?: string;
}

class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  current_password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  new_password!: string;
}

type RequestWithAuth = {
  user?: AuthenticatedRequestUser;
  headers?: IncomingHttpHeaders;
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
  ): Promise<Awaited<ReturnType<AuthService['login']>>> {
    const result = await this.authService.login(body, getRequestMetadata(request));
    setRefreshCookie(response, result.refresh_token);
    return result;
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Body() body: RefreshDto,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<Awaited<ReturnType<AuthService['refresh']>>> {
    const result = await this.authService.refresh(body.refresh_token, getRequestMetadata(request));
    setRefreshCookie(response, result.refresh_token);
    return result;
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(
    @Body() body: LogoutDto | undefined,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ success: true }> {
    const result = await this.authService.logout(getAuthenticatedUser(request), body ?? {}, getRequestMetadata(request));
    clearRefreshCookie(response);
    return result;
  }

  @Get('me')
  async me(@Req() request: RequestWithAuth): Promise<Awaited<ReturnType<AuthService['getCurrentUser']>>> {
    return this.authService.getCurrentUser(getAuthenticatedUser(request));
  }

  @HttpCode(HttpStatus.OK)
  @Post('password/change')
  async changePassword(
    @Body() body: ChangePasswordDto,
    @Req() request: RequestWithAuth,
  ): Promise<{ success: true }> {
    return this.authService.changePassword(getAuthenticatedUser(request), body, getRequestMetadata(request));
  }

  @Get('sessions')
  async listSessions(@Req() request: RequestWithAuth): Promise<SessionSummary[]> {
    const user = getAuthenticatedUser(request);
    return this.sessionService.listActiveSessions({
      tenantId: user.tenant_id,
      userId: user.sub,
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
  setResponseHeader(
    response,
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}; Max-Age=${REFRESH_COOKIE_MAX_AGE_SECONDS}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax`,
  );
}

function clearRefreshCookie(response: CookieResponse): void {
  setResponseHeader(
    response,
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=; Max-Age=0; Path=/api/auth; HttpOnly; Secure; SameSite=Lax`,
  );
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
  return request.ip ?? request.raw?.ip ?? request.socket?.remoteAddress ?? request.raw?.socket?.remoteAddress;
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
