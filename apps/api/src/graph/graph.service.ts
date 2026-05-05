import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ROLES, normalizeRole } from '@cherrygraph/auth-core';
import {
  ErrorCode,
  group_members,
  space_permissions,
  spaces,
} from '@cherrygraph/shared';
import {
  GraphQueryService,
  type GraphPath,
  type GraphQueryEdge,
  type GraphQueryNode,
} from '@cherrygraph/graph-core';
import { and, eq, inArray } from 'drizzle-orm';

import { DRIZZLE } from '../database/drizzle.constants.js';
import type { DrizzleDatabase } from '../database/drizzle.module.js';
import type {
  GraphCommunitiesQueryDto,
  GraphCommunitiesResponseDto,
  GraphNeighborsQueryDto,
  GraphNeighborsResponseDto,
  GraphNodeSearchQueryDto,
  GraphPathListResponseDto,
  GraphPathRequestDto,
  GraphSearchResponseDto,
} from './graph.dto.js';

type SpaceRow = typeof spaces.$inferSelect;

export type GraphContext = {
  tenantId?: string;
  actorUserId?: string;
  actorRole?: string;
  userId?: string;
  actorPermissions?: string[];
  spacePermissions?: Record<string, string[]>;
};

const READ_SATISFYING_PERMISSIONS = ['space:read', 'space:view', 'space:edit', 'space:admin'] as const;

@Injectable()
export class GraphService {
  private readonly queryService: GraphQueryService;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDatabase) {
    this.queryService = new GraphQueryService(db);
  }

  async searchNodes(
    input: GraphNodeSearchQueryDto,
    context: GraphContext = {},
  ): Promise<GraphSearchResponseDto> {
    const spaceIds = await this.resolveReadableSpaceIds(input.space_id, context);
    if (spaceIds.length === 0) {
      return { nodes: [], total: 0 };
    }

    const nodes = await this.queryService.searchNodes(input.q, spaceIds, input.top_k);
    return {
      nodes,
      total: nodes.length,
    };
  }

  async findPath(
    input: GraphPathRequestDto,
    context: GraphContext = {},
  ): Promise<GraphPathListResponseDto> {
    const spaceIds = await this.resolveReadableSpaceIds(undefined, context);
    if (spaceIds.length === 0) {
      return { paths: [] };
    }

    const paths = await this.queryService.findPath(
      input.source_node_id,
      input.target_node_id,
      input.max_hops,
      spaceIds,
    );

    return { paths };
  }

  async getNeighbors(
    nodeId: string,
    input: GraphNeighborsQueryDto,
    context: GraphContext = {},
  ): Promise<GraphNeighborsResponseDto> {
    const spaceIds = await this.resolveReadableSpaceIds(undefined, context);
    if (spaceIds.length === 0) {
      return { center_node: null, neighbors: [] };
    }

    const result = await this.queryService.getNeighbors(nodeId, input.hops, spaceIds);
    const centerNode = result.nodes.find((node) => node.id === nodeId) ?? null;

    return {
      center_node: centerNode,
      neighbors: buildNeighborItems(nodeId, result.nodes, result.edges),
    };
  }

  async getCommunities(
    input: GraphCommunitiesQueryDto,
    context: GraphContext = {},
  ): Promise<GraphCommunitiesResponseDto> {
    const spaceIds = await this.resolveReadableSpaceIds(input.space_id, context);
    if (spaceIds.length === 0) {
      return { communities: [] };
    }

    const communities = await this.queryService.getCommunities(spaceIds);
    return { communities };
  }

  async getCommunityNodes(
    communityId: string,
    context: GraphContext = {},
  ): Promise<GraphQueryNode[]> {
    const spaceIds = await this.resolveReadableSpaceIds(undefined, context);
    if (spaceIds.length === 0) {
      return [];
    }

    return this.queryService.getCommunityNodes(communityId, spaceIds);
  }

  async getEvidenceRefs(edgeId: string): ReturnType<GraphQueryService['getEvidenceRefs']> {
    return this.queryService.getEvidenceRefs(edgeId);
  }

  filterPathsByACL(paths: GraphPath[], allowedSpaceIds: string[]): GraphPath[] {
    return this.queryService.filterPathsByACL(paths, allowedSpaceIds);
  }

  private async resolveReadableSpaceIds(
    spaceId: string | undefined,
    context: GraphContext,
  ): Promise<string[]> {
    const tenantId = resolveTenantId(context);
    if (spaceId !== undefined && spaceId.trim().length > 0) {
      await this.assertSpaceReadable(tenantId, spaceId.trim(), context);
      return [spaceId.trim()];
    }

    const requestScopedSpaceIds = readableSpaceIdsFromContext(context);
    if (requestScopedSpaceIds !== undefined) {
      return requestScopedSpaceIds;
    }

    if (hasImplicitSpaceAccess(context.actorRole)) {
      const rows = await this.db
        .select({ id: spaces.id })
        .from(spaces)
        .where(eq(spaces.tenant_id, tenantId));
      return rows.map((row) => row.id);
    }

    const userId = resolveContextUserId(context);
    return this.getAccessibleSpaceIds(tenantId, userId);
  }

  private async assertSpaceReadable(
    tenantId: string,
    spaceId: string,
    context: GraphContext,
  ): Promise<SpaceRow> {
    const [space] = await this.db
      .select()
      .from(spaces)
      .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.id, spaceId)))
      .limit(1);

    if (space === undefined) {
      throwApiError(ErrorCode.SPACE_NOT_FOUND, 'Space not found', HttpStatus.NOT_FOUND);
    }

    if (
      hasImplicitSpaceAccess(context.actorRole) ||
      permissionSetSatisfies(context.actorPermissions ?? [], READ_SATISFYING_PERMISSIONS) ||
      permissionSetSatisfies(context.spacePermissions?.[spaceId] ?? [], READ_SATISFYING_PERMISSIONS)
    ) {
      return space;
    }

    const userId = resolveContextUserId(context);
    const allowed = await this.hasSpaceReadPermission(tenantId, userId, spaceId);
    if (!allowed) {
      throwApiError(ErrorCode.PERMISSION_DENIED, 'Permission denied', HttpStatus.FORBIDDEN);
    }

    return space;
  }

  private async getAccessibleSpaceIds(tenantId: string, userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ space_id: space_permissions.space_id })
      .from(group_members)
      .innerJoin(
        space_permissions,
        and(
          eq(space_permissions.tenant_id, group_members.tenant_id),
          eq(space_permissions.group_id, group_members.group_id),
        ),
      )
      .where(
        and(
          eq(group_members.tenant_id, tenantId),
          eq(group_members.user_id, userId),
          inArray(space_permissions.permission, [...READ_SATISFYING_PERMISSIONS]),
        ),
      );

    return [...new Set(rows.map((row) => row.space_id))];
  }

  private async hasSpaceReadPermission(
    tenantId: string,
    userId: string,
    spaceId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ space_id: space_permissions.space_id })
      .from(group_members)
      .innerJoin(
        space_permissions,
        and(
          eq(space_permissions.tenant_id, group_members.tenant_id),
          eq(space_permissions.group_id, group_members.group_id),
        ),
      )
      .where(
        and(
          eq(group_members.tenant_id, tenantId),
          eq(group_members.user_id, userId),
          eq(space_permissions.space_id, spaceId),
          inArray(space_permissions.permission, [...READ_SATISFYING_PERMISSIONS]),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }
}

function buildNeighborItems(
  centerNodeId: string,
  nodes: GraphQueryNode[],
  edges: GraphQueryEdge[],
): GraphNeighborsResponseDto['neighbors'] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const distances = new Map<string, number>([[centerNodeId, 0]]);
  const incomingEdge = new Map<string, GraphQueryEdge | null>([[centerNodeId, null]]);
  const queue = [centerNodeId];

  for (let index = 0; index < queue.length; index += 1) {
    const currentNodeId = queue[index];
    if (currentNodeId === undefined) {
      continue;
    }

    const currentDistance = distances.get(currentNodeId) ?? 0;
    for (const edge of edges) {
      const nextNodeId = nextNodeForEdge(edge, currentNodeId);
      if (nextNodeId === undefined || !nodeById.has(nextNodeId) || distances.has(nextNodeId)) {
        continue;
      }

      distances.set(nextNodeId, currentDistance + 1);
      incomingEdge.set(nextNodeId, edge);
      queue.push(nextNodeId);
    }
  }

  return nodes
    .filter((node) => node.id !== centerNodeId && distances.has(node.id))
    .map((node) => ({
      node,
      edge: incomingEdge.get(node.id) ?? null,
      hop: distances.get(node.id) ?? 0,
    }))
    .sort((left, right) => left.hop - right.hop || left.node.label.localeCompare(right.node.label));
}

function nextNodeForEdge(edge: GraphQueryEdge, nodeId: string): string | undefined {
  if (edge.source_node_id === nodeId) {
    return edge.target_node_id;
  }

  if (edge.target_node_id === nodeId) {
    return edge.source_node_id;
  }

  return undefined;
}

function readableSpaceIdsFromContext(context: GraphContext): string[] | undefined {
  if (context.spacePermissions === undefined) {
    return undefined;
  }

  return Object.entries(context.spacePermissions)
    .filter(([, permissions]) => permissionSetSatisfies(permissions, READ_SATISFYING_PERMISSIONS))
    .map(([spaceId]) => spaceId);
}

function permissionSetSatisfies(
  permissions: readonly string[],
  acceptedPermissions: readonly string[],
): boolean {
  return permissions.some((permission) => acceptedPermissions.includes(permission));
}

function hasImplicitSpaceAccess(role: string | undefined): boolean {
  const normalized = role === undefined ? undefined : normalizeRole(role);
  return normalized === ROLES.OWNER || normalized === ROLES.ADMIN;
}

function resolveTenantId(context: GraphContext): string {
  if (context.tenantId !== undefined && context.tenantId.trim().length > 0) {
    return context.tenantId.trim();
  }

  const configuredTenantId = process.env.DEFAULT_TENANT_ID;
  if (configuredTenantId !== undefined && configuredTenantId.trim().length > 0) {
    return configuredTenantId.trim();
  }

  throwApiError(ErrorCode.UNAUTHENTICATED, 'Unauthenticated', HttpStatus.UNAUTHORIZED);
}

function resolveContextUserId(context: GraphContext): string {
  const userId = context.userId ?? context.actorUserId;
  if (userId !== undefined && userId.trim().length > 0) {
    return userId.trim();
  }

  throwApiError(ErrorCode.UNAUTHENTICATED, 'Unauthenticated', HttpStatus.UNAUTHORIZED);
}

function throwApiError(code: ErrorCode, message: string, status: HttpStatus): never {
  throw new HttpException({ code, message }, status);
}
