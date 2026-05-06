import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { IsIn, IsOptional } from 'class-validator';

import {
  ApiTokenService,
  type ApiTokenAuditContext,
  type ApiTokenCreateResponse,
  type ApiTokenListItem,
  type ApiTokenRevokeResponse,
} from './api-token.service.js';

class ApiTokenListQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  include_revoked?: string;
}

type RequestWithAuth = {
  user?: AuthenticatedRequestUser;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  raw?: {
    ip?: string;
    headers?: Record<string, string | string[] | undefined>;
    request_id?: string;
    socket?: {
      remoteAddress?: string;
    };
  };
  socket?: {
    remoteAddress?: string;
  };
  request_id?: string;
  id?: string;
};

@Controller('admin/api-tokens')
export class ApiTokenAdminController {
  constructor(private readonly apiTokenService: ApiTokenService) {}

  @Post()
  @Permissions('admin:user_manage')
  async createToken(
    @Body() body: unknown,
    @Req() request: RequestWithAuth,
  ): Promise<ApiTokenCreateResponse> {
    const user = getAuthenticatedUser(request);
    return this.apiTokenService.createToken(body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      audit: buildAuditContext(request),
    });
  }

  @Get()
  @Permissions('admin:user_manage')
  async listTokens(
    @Query() query: ApiTokenListQueryDto,
    @Req() request: RequestWithAuth,
  ): Promise<ApiTokenListItem[]> {
    const user = getAuthenticatedUser(request);
    return this.apiTokenService.listTokens(query, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      audit: buildAuditContext(request),
    });
  }

  @Delete(':tokenId')
  @Permissions('admin:user_manage')
  async revokeToken(
    @Param('tokenId') tokenId: string,
    @Req() request: RequestWithAuth,
  ): Promise<ApiTokenRevokeResponse> {
    const user = getAuthenticatedUser(request);
    return this.apiTokenService.revokeToken(tokenId, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      audit: buildAuditContext(request),
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

function buildAuditContext(request: RequestWithAuth): ApiTokenAuditContext {
  const requestId = readSingleHeader(request, 'x-request-id') ?? request.request_id ?? request.raw?.request_id ?? request.id;
  const ip = request.ip ?? request.raw?.ip ?? request.socket?.remoteAddress ?? request.raw?.socket?.remoteAddress;
  const userAgent = readSingleHeader(request, 'user-agent');

  return {
    ...(ip !== undefined ? { ip } : {}),
    ...(userAgent !== undefined ? { userAgent } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

function readSingleHeader(request: RequestWithAuth, name: string): string | undefined {
  const value = request.headers?.[name] ?? request.raw?.headers?.[name];
  if (typeof value === 'string') {
    return value;
  }

  return Array.isArray(value) ? value[0] : undefined;
}
