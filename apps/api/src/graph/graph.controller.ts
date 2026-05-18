import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';

import {
  parseGraphCommunitiesQuery,
  parseGraphCommunityNodesQuery,
  parseGraphNeighborsQuery,
  parseGraphNodeSearchQuery,
  parseGraphPathRequest,
  type GraphCommunitiesResponseDto,
  type GraphCommunityNodesResponseDto,
  type GraphNeighborsResponseDto,
  type GraphPathListResponseDto,
  type GraphSearchResponseDto,
} from './graph.dto.js';
import { GraphService, type GraphContext } from './graph.service.js';

type RequestUserWithPermissions = AuthenticatedRequestUser & {
  permissions?: string[];
  space_permissions?: Record<string, string[]>;
};

type RequestWithAuth = {
  user?: RequestUserWithPermissions;
  permissions?: string[];
  space_permissions?: Record<string, string[]>;
};

@Controller('graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Get('nodes')
  @Permissions('space:read')
  async searchNodes(
    @Query() query: Record<string, unknown>,
    @Req() request: RequestWithAuth,
  ): Promise<GraphSearchResponseDto> {
    const user = getAuthenticatedUser(request);
    return this.graphService.searchNodes(parseGraphNodeSearchQuery(query), buildGraphContext(request, user));
  }

  @Post('path')
  @Permissions('space:read')
  async findPath(
    @Body() body: unknown,
    @Req() request: RequestWithAuth,
  ): Promise<GraphPathListResponseDto> {
    const user = getAuthenticatedUser(request);
    return this.graphService.findPath(parseGraphPathRequest(body), buildGraphContext(request, user));
  }

  @Get('nodes/:id/neighbors')
  @Permissions('space:read')
  async getNeighbors(
    @Param('id') nodeId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: RequestWithAuth,
  ): Promise<GraphNeighborsResponseDto> {
    const user = getAuthenticatedUser(request);
    return this.graphService.getNeighbors(nodeId, parseGraphNeighborsQuery(query), buildGraphContext(request, user));
  }

  @Get('communities')
  @Permissions('space:read')
  async getCommunities(
    @Query() query: Record<string, unknown>,
    @Req() request: RequestWithAuth,
  ): Promise<GraphCommunitiesResponseDto> {
    const user = getAuthenticatedUser(request);
    return this.graphService.getCommunities(parseGraphCommunitiesQuery(query), buildGraphContext(request, user));
  }

  @Get('communities/:id/nodes')
  @Permissions('space:read')
  async getCommunityNodes(
    @Param('id') communityId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: RequestWithAuth,
  ): Promise<GraphCommunityNodesResponseDto> {
    const user = getAuthenticatedUser(request);
    return this.graphService.getCommunityNodes(
      communityId,
      parseGraphCommunityNodesQuery(query),
      buildGraphContext(request, user),
    );
  }
}

function getAuthenticatedUser(request: RequestWithAuth): RequestUserWithPermissions {
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

function buildGraphContext(request: RequestWithAuth, user: RequestUserWithPermissions): GraphContext {
  const actorPermissions = request.permissions ?? user.permissions;
  const spacePermissions = request.space_permissions ?? user.space_permissions;

  return {
    tenantId: user.tenant_id,
    actorUserId: user.sub,
    actorRole: user.role,
    userId: user.sub,
    userGroupIds: user.group_ids,
    ...(actorPermissions !== undefined ? { actorPermissions } : {}),
    ...(spacePermissions !== undefined ? { spacePermissions } : {}),
  };
}
