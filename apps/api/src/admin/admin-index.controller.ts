import { Body, Controller, Get, Headers, HttpCode, HttpException, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import type { JobRow } from '@cherrygraph/job-core';
import { ErrorCode } from '@cherrygraph/shared';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import {
  AdminIndexService,
  type AdminIndexContext,
  type ModelUsageAggregate,
  type RetrievalTraceResponse,
} from './admin-index.service.js';

type RequestWithAuth = {
  user?: AuthenticatedRequestUser & {
    permissions?: string[];
  };
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  id?: string;
};

class ModelUsageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  start_time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  end_time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  request_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model_config_id?: string;
}

@Controller('admin')
export class AdminIndexController {
  constructor(private readonly adminIndexService: AdminIndexService) {}

  @Get('retrieval-traces/:id')
  @Permissions('admin')
  async getRetrievalTrace(
    @Param('id') id: string,
    @Req() request: RequestWithAuth,
  ): Promise<{ data: RetrievalTraceResponse }> {
    const user = getAuthenticatedUser(request);
    const data = await this.adminIndexService.getRetrievalTrace(id, buildAdminIndexContext(request, user));
    return { data };
  }

  @Get('model-usage')
  @Permissions('admin')
  async getModelUsage(
    @Query() query: ModelUsageQueryDto,
    @Req() request: RequestWithAuth,
  ): Promise<{ data: ModelUsageAggregate[] }> {
    const user = getAuthenticatedUser(request);
    const data = await this.adminIndexService.getModelUsage(query, buildAdminIndexContext(request, user));
    return { data };
  }

  @Post('spaces/:spaceId/rebuild-index')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('admin')
  async rebuildIndex(
    @Param('spaceId') spaceId: string,
    @Body() body: { scope?: string; reason?: string } | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Req() request: RequestWithAuth,
  ): Promise<{ data: JobRow }> {
    const user = getAuthenticatedUser(request);
    const data = await this.adminIndexService.rebuildIndex(
      spaceId,
      body ?? {},
      buildAdminIndexContext(request, user),
      idempotencyKey,
    );

    return { data };
  }
}

function getAuthenticatedUser(request: RequestWithAuth): AuthenticatedRequestUser & { permissions?: string[] } {
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

function buildAdminIndexContext(
  request: RequestWithAuth,
  user: AuthenticatedRequestUser & { permissions?: string[] },
): AdminIndexContext {
  const userAgent = request.headers?.['user-agent'];
  const requestId = request.headers?.['x-request-id'];

  return {
    tenantId: user.tenant_id,
    actorUserId: user.sub,
    ...(request.ip !== undefined ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
    ...(typeof requestId === 'string' ? { requestId } : {}),
    ...(request.id !== undefined ? { requestId: request.id } : {}),
  };
}
