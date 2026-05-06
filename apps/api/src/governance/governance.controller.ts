import { Body, Controller, Get, HttpException, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { GovernanceService, type GovernanceAuditContext } from './governance.service.js';

class GovernanceListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  space_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

class LowConfidenceEdgesQueryDto extends GovernanceListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  threshold?: number;
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

@Controller('admin/governance')
export class GovernanceController {
  constructor(private readonly governanceService: GovernanceService) {}

  @Get('low-confidence-edges')
  @Permissions('admin:user_manage')
  async listLowConfidenceEdges(
    @Query() query: LowConfidenceEdgesQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<GovernanceService['listLowConfidenceEdges']> {
    const user = getAuthenticatedUser(request);
    return this.governanceService.listLowConfidenceEdges(query, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      audit: buildAuditContext(request),
    });
  }

  @Patch('edges/:edgeId/review')
  @Permissions('admin:user_manage')
  async reviewEdge(
    @Param('edgeId') edgeId: string,
    @Body() body: unknown,
    @Req() request: RequestWithAuth,
  ): ReturnType<GovernanceService['reviewEdge']> {
    const user = getAuthenticatedUser(request);
    return this.governanceService.reviewEdge(edgeId, body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      audit: buildAuditContext(request),
    });
  }

  @Get('duplicate-suggestions')
  @Permissions('admin:user_manage')
  async listDuplicateSuggestions(
    @Query() query: GovernanceListQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<GovernanceService['listDuplicateSuggestions']> {
    const user = getAuthenticatedUser(request);
    return this.governanceService.listDuplicateSuggestions(query, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      audit: buildAuditContext(request),
    });
  }

  @Post('merge')
  @Permissions('admin:user_manage')
  async mergePages(
    @Body() body: unknown,
    @Req() request: RequestWithAuth,
  ): ReturnType<GovernanceService['mergePages']> {
    const user = getAuthenticatedUser(request);
    return this.governanceService.mergePages(body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      audit: buildAuditContext(request),
    });
  }

  @Get('conflicts')
  @Permissions('admin:user_manage')
  async listConflicts(
    @Query() query: GovernanceListQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<GovernanceService['listConflicts']> {
    const user = getAuthenticatedUser(request);
    return this.governanceService.listConflicts(query, {
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

function buildAuditContext(request: RequestWithAuth): GovernanceAuditContext {
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
