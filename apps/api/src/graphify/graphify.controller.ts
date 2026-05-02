import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';

import { CreateGraphifyRunDto, GraphifyRunsQueryDto } from './graphify.dto.js';
import { GraphifyService, type GraphifyContext } from './graphify.service.js';

type RequestWithAuth = {
  user?: AuthenticatedRequestUser & {
    permissions?: string[];
  };
  permissions?: string[];
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  id?: string;
};

@Controller()
export class GraphifyController {
  constructor(private readonly graphifyService: GraphifyService) {}

  @Post('spaces/:spaceId/graphify/runs')
  @Permissions('graphify:run')
  async createRun(
    @Param('spaceId') spaceId: string,
    @Body() body: CreateGraphifyRunDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<GraphifyService['createRun']> {
    const user = getAuthenticatedUser(request);
    return this.graphifyService.createRun(spaceId, body, buildGraphifyContext(request, user));
  }

  @Get('graphify/runs')
  async listRuns(
    @Query() query: GraphifyRunsQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<GraphifyService['listRuns']> {
    const user = getAuthenticatedUser(request);
    return this.graphifyService.listRuns(query, buildGraphifyContext(request, user));
  }

  @Get('graphify/runs/:runId')
  async getRun(
    @Param('runId') runId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<GraphifyService['getRun']> {
    const user = getAuthenticatedUser(request);
    return this.graphifyService.getRun(runId, buildGraphifyContext(request, user));
  }

  @Post('graphify/runs/:runId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelRun(
    @Param('runId') runId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<GraphifyService['cancelRun']> {
    const user = getAuthenticatedUser(request);
    return this.graphifyService.cancelRun(runId, buildGraphifyContext(request, user));
  }

  @Post('graphify/runs/:runId/retry')
  async retryRun(
    @Param('runId') runId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<GraphifyService['retryRun']> {
    const user = getAuthenticatedUser(request);
    return this.graphifyService.retryRun(runId, buildGraphifyContext(request, user));
  }

  @Get('graphify/runs/:runId/report')
  async getReport(
    @Param('runId') runId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<GraphifyService['getReport']> {
    const user = getAuthenticatedUser(request);
    return this.graphifyService.getReport(runId, buildGraphifyContext(request, user));
  }

  @Get('graphify/runs/:runId/graph')
  @Permissions('admin')
  async getGraphSummary(
    @Param('runId') runId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<GraphifyService['getGraphSummary']> {
    const user = getAuthenticatedUser(request);
    return this.graphifyService.getGraphSummary(runId, buildGraphifyContext(request, user));
  }

  @Get('admin/graphify/runs')
  @Permissions('admin')
  async adminListRuns(
    @Query() query: GraphifyRunsQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<GraphifyService['listRuns']> {
    const user = getAuthenticatedUser(request);
    return this.graphifyService.listRuns(query, buildGraphifyContext(request, user));
  }

  @Post('admin/graphify/runs/:runId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('admin')
  async adminRetryRun(
    @Param('runId') runId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<GraphifyService['retryRun']> {
    const user = getAuthenticatedUser(request);
    return this.graphifyService.retryRun(runId, buildGraphifyContext(request, user));
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

function buildGraphifyContext(
  request: RequestWithAuth,
  user: AuthenticatedRequestUser & { permissions?: string[] },
): GraphifyContext {
  const userAgent = request.headers?.['user-agent'];
  const requestId = request.headers?.['x-request-id'];
  const actorPermissions = request.permissions ?? user.permissions;

  return {
    tenantId: user.tenant_id,
    actorUserId: user.sub,
    actorRole: user.role,
    userId: user.sub,
    ...(actorPermissions !== undefined ? { actorPermissions } : {}),
    audit: {
      ...(request.ip !== undefined ? { ip: request.ip } : {}),
      ...(typeof userAgent === 'string' ? { userAgent } : {}),
      ...(typeof requestId === 'string' ? { requestId } : {}),
      ...(request.id !== undefined ? { requestId: request.id } : {}),
    },
  };
}
