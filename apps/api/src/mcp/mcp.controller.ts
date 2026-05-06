import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Permissions, Public, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { IsIn, IsOptional } from 'class-validator';

import type { ApiTokenAuthenticatedUser } from '../api-tokens/api-token.service.js';
import { McpService, type McpAuditContext, type McpResponseLike } from './mcp.service.js';

class McpToolListQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  include_inactive?: string;
}

type RequestWithAuth = {
  user?: AuthenticatedRequestUser | ApiTokenAuthenticatedUser;
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

@Controller('admin/mcp/tools')
export class McpAdminController {
  constructor(private readonly mcpService: McpService) {}

  @Post()
  @Permissions('admin:user_manage')
  async createTool(@Body() body: unknown, @Req() request: RequestWithAuth): ReturnType<McpService['createTool']> {
    const user = getAuthenticatedUser(request);
    return this.mcpService.createTool(body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      audit: buildAuditContext(request),
    });
  }

  @Get()
  @Permissions('admin:user_manage')
  async listTools(
    @Query() query: McpToolListQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<McpService['listTools']> {
    const user = getAuthenticatedUser(request);
    return this.mcpService.listTools(query, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      audit: buildAuditContext(request),
    });
  }

  @Delete(':toolId')
  @Permissions('admin:user_manage')
  async deleteTool(
    @Param('toolId') toolId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<McpService['deleteTool']> {
    const user = getAuthenticatedUser(request);
    return this.mcpService.deleteTool(toolId, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      audit: buildAuditContext(request),
    });
  }

  @Put(':toolId/policy')
  @Permissions('admin:user_manage')
  async updatePolicy(
    @Param('toolId') toolId: string,
    @Body() body: unknown,
    @Req() request: RequestWithAuth,
  ): ReturnType<McpService['updatePolicy']> {
    const user = getAuthenticatedUser(request);
    return this.mcpService.updatePolicy(toolId, body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      audit: buildAuditContext(request),
    });
  }
}

@Controller('mcp')
export class McpInvokeController {
  constructor(private readonly mcpService: McpService) {}

  @Post('invoke')
  @Public()
  async invokeTool(
    @Body() body: unknown,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: McpResponseLike,
  ): ReturnType<McpService['invokeTool']> {
    return this.mcpService.invokeTool(body, {
      caller: request.user,
      audit: buildAuditContext(request),
      response,
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

function buildAuditContext(request: RequestWithAuth): McpAuditContext {
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
