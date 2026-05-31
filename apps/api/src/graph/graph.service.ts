import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ROLES, normalizeRole } from '@cherrygraph/auth-core';
import {
  ErrorCode,
  group_members,
  space_permissions,
  spaces,
} from '@cherrygraph/shared';
import {
  type ActiveGraphifyRunIds,
  GraphQueryService,
  type GraphPath,
  type GraphQueryEdge,
  type GraphQueryNode,
} from '@cherrygraph/graph-core';
import { and, eq, inArray } from 'drizzle-orm';

import { DRIZZLE } from '../database/drizzle.constants.js';
import { throwApiError } from '../common/errors/api-error.js';
import type { DrizzleDatabase } from '../database/drizzle.module.js';
import { SPACE_VIEW_PERMISSIONS } from '../shared/permission-constants.js';
import type {
  GraphCommunitiesQueryDto,
  GraphCommunitiesResponseDto,
  GraphCommunityNodesQueryDto,
  GraphCommunityNodesResponseDto,
  GraphEdgeResponseDto,
  GraphNeighborsQueryDto,
  GraphNeighborsResponseDto,
  GraphNodeResponseDto,
  GraphNodeSearchQueryDto,
  GraphPathListResponseDto,
  GraphPathResponseDto,
  GraphPathRequestDto,
  GraphSearchResponseDto,
} from './graph.dto.js';

type SpaceRow = typeof spaces.$inferSelect;

export type GraphContext = {
  tenantId?: string;
  actorUserId?: string;
  actorRole?: string;
  userId?: string;
  userGroupIds?: string[];
  actorPermissions?: string[];
  spacePermissions?: Record<string, string[]>;
};

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

    const activeRunIds = await this.resolveActiveGraphifyRunIds(spaceIds, context);
    if (activeRunIds.size === 0) {
      return { nodes: [], total: 0 };
    }

    const nodes = await this.queryService.searchNodes(input.q, spaceIds, activeRunIds, input.top_k);
    return {
      nodes: nodes.map(toGraphNodeResponse),
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

    const activeRunIds = await this.resolveActiveGraphifyRunIds(spaceIds, context);
    if (activeRunIds.size === 0) {
      return { paths: [] };
    }

    const paths = await this.queryService.findPath(
      input.source_node_id,
      input.target_node_id,
      input.max_hops,
      spaceIds,
      activeRunIds,
    );

    return { paths: paths.map(toGraphPathResponse) };
  }

  async getNeighbors(
    nodeId: string,
    input: GraphNeighborsQueryDto,
    context: GraphContext = {},
  ): Promise<GraphNeighborsResponseDto> {
    const spaceIds = await this.resolveReadableSpaceIds(input.space_id, context);
    if (spaceIds.length === 0) {
      return { center_node: null, neighbors: [] };
    }

    const activeRunIds = await this.resolveActiveGraphifyRunIds(spaceIds, context);
    if (activeRunIds.size === 0) {
      return { center_node: null, neighbors: [] };
    }

    const result = await this.queryService.getNeighbors(nodeId, input.hops, spaceIds, activeRunIds);
    const centerNode = result.nodes.find((node) => node.id === nodeId) ?? null;

    return {
      center_node: centerNode === null ? null : toGraphNodeResponse(centerNode),
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

    const activeRunIds = await this.resolveActiveGraphifyRunIds(spaceIds, context);
    if (activeRunIds.size === 0) {
      return { communities: [] };
    }

    const communities = await this.queryService.getCommunities(spaceIds, activeRunIds);
    return { communities };
  }

  async getCommunityNodes(
    communityId: string,
    input: GraphCommunityNodesQueryDto,
    context: GraphContext = {},
  ): Promise<GraphCommunityNodesResponseDto> {
    const spaceIds = await this.resolveReadableSpaceIds(input.space_id, context);
    if (spaceIds.length === 0) {
      return { nodes: [], edges: [], truncated: false };
    }

    const activeRunIds = await this.resolveActiveGraphifyRunIds(spaceIds, context);
    if (activeRunIds.size === 0) {
      return { nodes: [], edges: [], truncated: false };
    }

    const result = await this.queryService.getCommunityNodes(communityId, spaceIds, activeRunIds);
    return {
      nodes: result.nodes.map(toGraphNodeResponse),
      edges: result.edges.map(toGraphEdgeResponse),
      truncated: result.truncated,
    };
  }

  async getEvidenceRefs(
    edgeId: string,
    context: GraphContext = {},
  ): ReturnType<GraphQueryService['getEvidenceRefs']> {
    return this.queryService.getEvidenceRefs(edgeId, await this.resolveReadableSpaceIds(undefined, context));
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
    return this.getAccessibleSpaceIds(tenantId, userId, context.userGroupIds);
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
      permissionSetSatisfies(context.actorPermissions ?? [], SPACE_VIEW_PERMISSIONS) ||
      permissionSetSatisfies(context.spacePermissions?.[spaceId] ?? [], SPACE_VIEW_PERMISSIONS)
    ) {
      return space;
    }

    const userId = resolveContextUserId(context);
    const allowed = await this.hasSpaceReadPermission(tenantId, userId, spaceId, context.userGroupIds);
    if (!allowed) {
      throwApiError(ErrorCode.SPACE_NOT_FOUND, 'Space not found', HttpStatus.NOT_FOUND);
    }

    return space;
  }

  private async resolveActiveGraphifyRunIds(
    spaceIds: string[],
    context: GraphContext,
  ): Promise<ActiveGraphifyRunIds> {
    const scopedSpaceIds = uniqueNonEmpty(spaceIds);
    if (scopedSpaceIds.length === 0) {
      return new Map();
    }

    const tenantId = resolveTenantId(context);
    const rows = await this.db
      .select({ id: spaces.id, active_graphify_run_id: spaces.active_graphify_run_id })
      .from(spaces)
      .where(and(eq(spaces.tenant_id, tenantId), inArray(spaces.id, scopedSpaceIds)));

    const activeRunIds: ActiveGraphifyRunIds = new Map();
    for (const row of rows) {
      const runId = row.active_graphify_run_id?.trim();
      if (runId !== undefined && runId.length > 0) {
        activeRunIds.set(row.id, runId);
      }
    }

    return activeRunIds;
  }

  private async getAccessibleSpaceIds(
    tenantId: string,
    userId: string,
    userGroupIds?: string[],
  ): Promise<string[]> {
    const groupScopedSpaceIds = await this.getAccessibleSpaceIdsForGroups(tenantId, userGroupIds);
    if (groupScopedSpaceIds !== undefined) {
      return groupScopedSpaceIds;
    }

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
          inArray(space_permissions.permission, [...SPACE_VIEW_PERMISSIONS]),
        ),
      );

    return [...new Set(rows.map((row) => row.space_id))];
  }

  private async hasSpaceReadPermission(
    tenantId: string,
    userId: string,
    spaceId: string,
    userGroupIds?: string[],
  ): Promise<boolean> {
    const groupScopedAllowed = await this.hasSpaceReadPermissionForGroups(tenantId, spaceId, userGroupIds);
    if (groupScopedAllowed !== undefined) {
      return groupScopedAllowed;
    }

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
          inArray(space_permissions.permission, [...SPACE_VIEW_PERMISSIONS]),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  private async getAccessibleSpaceIdsForGroups(
    tenantId: string,
    userGroupIds: string[] | undefined,
  ): Promise<string[] | undefined> {
    if (userGroupIds === undefined) {
      return undefined;
    }

    const groupIds = uniqueNonEmpty(userGroupIds);
    if (groupIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .select({ space_id: space_permissions.space_id })
      .from(space_permissions)
      .where(
        and(
          eq(space_permissions.tenant_id, tenantId),
          inArray(space_permissions.group_id, groupIds),
          inArray(space_permissions.permission, [...SPACE_VIEW_PERMISSIONS]),
        ),
      );

    return [...new Set(rows.map((row) => row.space_id))];
  }

  private async hasSpaceReadPermissionForGroups(
    tenantId: string,
    spaceId: string,
    userGroupIds: string[] | undefined,
  ): Promise<boolean | undefined> {
    if (userGroupIds === undefined) {
      return undefined;
    }

    const groupIds = uniqueNonEmpty(userGroupIds);
    if (groupIds.length === 0) {
      return false;
    }

    const rows = await this.db
      .select({ space_id: space_permissions.space_id })
      .from(space_permissions)
      .where(
        and(
          eq(space_permissions.tenant_id, tenantId),
          eq(space_permissions.space_id, spaceId),
          inArray(space_permissions.group_id, groupIds),
          inArray(space_permissions.permission, [...SPACE_VIEW_PERMISSIONS]),
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
      node: toGraphNodeResponse(node),
      edge: toNullableGraphEdgeResponse(incomingEdge.get(node.id) ?? null),
      hop: distances.get(node.id) ?? 0,
    }))
    .sort((left, right) => left.hop - right.hop || left.node.label.localeCompare(right.node.label));
}

function toGraphPathResponse(path: GraphPath): GraphPathResponseDto {
  return {
    nodes: path.nodes.map(toGraphNodeResponse),
    edges: path.edges.map(toGraphEdgeResponse),
    total_confidence: path.total_confidence,
  };
}

function toGraphNodeResponse(node: GraphQueryNode): GraphNodeResponseDto {
  return {
    id: node.id,
    node_key: node.node_key,
    stable_key: node.stable_key,
    label: node.label,
    node_type: node.node_type,
    description: node.description ?? null,
    space_id: node.space_id,
    community_id: node.community_id,
    score: node.score,
  };
}

function toNullableGraphEdgeResponse(edge: GraphQueryEdge | null): GraphEdgeResponseDto | null {
  return edge === null ? null : toGraphEdgeResponse(edge);
}

function toGraphEdgeResponse(edge: GraphQueryEdge): GraphEdgeResponseDto {
  return {
    id: edge.id,
    source_node_id: edge.source_node_id,
    target_node_id: edge.target_node_id,
    relationship: edge.relation_type,
    confidence_label: edge.confidence_label,
    effective_confidence_score: edge.effective_confidence_score,
    evidence_count: edge.evidence_count,
    space_id: edge.space_id,
  };
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
    .filter(([, permissions]) => permissionSetSatisfies(permissions, SPACE_VIEW_PERMISSIONS))
    .map(([spaceId]) => spaceId);
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
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
