import { HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { isPermissionPoint } from '@cherrygraph/auth-core';
import {
  ErrorCode,
  group_members,
  groups,
  permission_versions,
  space_permissions,
  spaces,
  tenants,
  users,
} from '@cherrygraph/shared';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';

import { AUDIT_EVENTS } from '../audit/audit-events.js';
import { AuditService } from '../audit/audit.service.js';
import {
  buildPaginationMeta,
  paginatedResponse,
  parseSortField,
  type PaginatedResponse,
} from '../common/dto/pagination.dto.js';
import { getApiLogger } from '../common/logger/logger.module.js';
import { REDIS_CLIENT } from '../common/redis/redis.module.js';
import { DRIZZLE } from '../database/drizzle.constants.js';

type GroupDatabase = NodePgDatabase;
type GroupRow = typeof groups.$inferSelect;

type RedisPublisher = {
  publish: (channel: string, message: string) => Promise<number>;
};

export type AdminContext = {
  tenantId?: string;
  actorUserId?: string;
};

export type ListGroupsInput = {
  page?: number;
  per_page?: number;
  sort?: string;
};

export type SpacePermissionInput = {
  space_id: string;
  permissions: string[];
};

export type CreateGroupInput = {
  name: string;
  description?: string;
  member_ids?: string[];
  space_permissions?: SpacePermissionInput[];
};

export type UpdateGroupInput = {
  name?: string;
  description?: string;
  member_ids?: string[];
  space_permissions?: SpacePermissionInput[];
};

export type ReplaceSpacePermissionsInput = {
  permissions: Array<{
    group_id: string;
    permissions: string[];
  }>;
};

export type GroupSpacePermissionsResponse = {
  space_id: string;
  permissions: string[];
};

export type AdminGroupResponse = {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  spaces: GroupSpacePermissionsResponse[];
  created_at: Date;
};

export type SpacePermissionGroupResponse = {
  group_id: string;
  name: string;
  permissions: string[];
};

type PermissionChange = {
  spaceId: string;
  groupId: string;
  oldPermissions: string[];
  newPermissions: string[];
};

type MemberChange = {
  userId: string;
  action: 'added' | 'removed';
};

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

@Injectable()
export class GroupService {
  constructor(
    @Inject(DRIZZLE) private readonly db: GroupDatabase,
    private readonly auditService: AuditService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: RedisPublisher,
  ) {}

  async listGroups(
    input: ListGroupsInput = {},
    context: AdminContext = {},
  ): Promise<PaginatedResponse<AdminGroupResponse>> {
    const tenantId = await this.resolveTenantId(context);
    const page = normalizePage(input.page);
    const perPage = normalizePerPage(input.per_page);
    const order = buildGroupOrder(input.sort ?? '-created_at');

    const rows = await this.db
      .select()
      .from(groups)
      .where(eq(groups.tenant_id, tenantId))
      .orderBy(order)
      .limit(perPage)
      .offset((page - 1) * perPage);
    const [countRow] = await this.db
      .select({ total: count() })
      .from(groups)
      .where(eq(groups.tenant_id, tenantId));
    const groupIds = rows.map((row) => row.id);
    const memberCounts = await this.getMemberCounts(tenantId, groupIds);
    const spacesByGroup = await this.getSpacesByGroup(tenantId, groupIds);

    return paginatedResponse(
      rows.map((row) => toAdminGroupResponse(row, memberCounts, spacesByGroup)),
      buildPaginationMeta(page, perPage, normalizeCount(countRow?.total)),
    );
  }

  async createGroup(
    input: CreateGroupInput,
    context: AdminContext = {},
  ): Promise<AdminGroupResponse> {
    const tenantId = await this.resolveTenantId(context);
    const memberIds = normalizeIdList(input.member_ids ?? []);
    const permissionsBySpace = normalizePermissionsBySpace(input.space_permissions ?? []);
    const affectedSpaces = [...permissionsBySpace.keys()];
    const now = new Date();

    try {
      const created = await this.db.transaction(async (tx) => {
        const txDb = tx as GroupDatabase;
        await validateUsersExist(txDb, tenantId, memberIds);
        await validateSpacesExist(txDb, tenantId, affectedSpaces);

        const [group] = await txDb
          .insert(groups)
          .values({
            id: randomUUID(),
            tenant_id: tenantId,
            name: input.name.trim(),
            description: input.description?.trim() ?? null,
            created_at: now,
          })
          .returning();

        if (group === undefined) {
          throw new Error('Failed to create group');
        }

        if (memberIds.length > 0) {
          await txDb.insert(group_members).values(
            memberIds.map((userId) => ({
              tenant_id: tenantId,
              group_id: group.id,
              user_id: userId,
              created_at: now,
            })),
          );
        }

        await replaceGroupSpacePermissions(txDb, {
          tenantId,
          groupId: group.id,
          permissionsBySpace,
          now,
        });

        for (const [spaceId, newPermissions] of permissionsBySpace) {
          await incrementSpacePermissionVersion(txDb, tenantId, spaceId, now);
          await insertPermissionVersion(txDb, {
            tenantId,
            spaceId,
            ...(context.actorUserId !== undefined ? { actorUserId: context.actorUserId } : {}),
            changeType: 'grant',
            groupId: group.id,
            oldPermissions: [],
            newPermissions,
            reason: 'group.create',
          });
        }

        return group;
      });

      for (const spaceId of affectedSpaces) {
        await this.publishSpacePermissionChanged(tenantId, spaceId);
      }

      this.auditService.push({
        tenant_id: tenantId,
        ...(context.actorUserId !== undefined ? { actor_user_id: context.actorUserId } : {}),
        action: AUDIT_EVENTS.ADMIN_GROUP_CREATE,
        resource_type: 'group',
        resource_id: created.id,
        metadata_json: {
          member_ids: memberIds,
          space_ids: affectedSpaces,
        },
      });

      return this.getGroupResponse(tenantId, created.id);
    } catch (err) {
      if (isUniqueViolation(err, 'groups_tenant_id_name_unique')) {
        throwApiError(ErrorCode.GROUP_NAME_CONFLICT, 'Group name already exists', HttpStatus.CONFLICT);
      }

      throw err;
    }
  }

  async updateGroup(
    groupId: string,
    input: UpdateGroupInput,
    context: AdminContext = {},
  ): Promise<AdminGroupResponse> {
    const tenantId = await this.resolveTenantId(context);
    const existing = await findGroupById(this.db, tenantId, groupId);
    if (existing === undefined) {
      throwApiError(ErrorCode.GROUP_NOT_FOUND, 'Group not found', HttpStatus.NOT_FOUND);
    }

    const nextMemberIds =
      input.member_ids !== undefined ? normalizeIdList(input.member_ids) : undefined;
    const nextPermissionsBySpace =
      input.space_permissions !== undefined
        ? normalizePermissionsBySpace(input.space_permissions)
        : undefined;
    const now = new Date();
    const memberChanges: MemberChange[] = [];
    const permissionChanges: PermissionChange[] = [];

    try {
      await this.db.transaction(async (tx) => {
        const txDb = tx as GroupDatabase;
        await validateUsersExist(txDb, tenantId, nextMemberIds ?? []);
        await validateSpacesExist(txDb, tenantId, [...(nextPermissionsBySpace?.keys() ?? [])]);

        const updateValues = buildGroupUpdateValues(existing, input);
        if (updateValues !== undefined) {
          await txDb
            .update(groups)
            .set(updateValues)
            .where(and(eq(groups.tenant_id, tenantId), eq(groups.id, groupId)));
        }

        if (nextMemberIds !== undefined) {
          const currentMemberIds = await getGroupMemberIds(txDb, tenantId, groupId);
          const diff = diffMembers(currentMemberIds, nextMemberIds);
          memberChanges.push(...diff);
          if (diff.length > 0) {
            await replaceGroupMembers(txDb, tenantId, groupId, nextMemberIds, now);
            await incrementUsersPermissionVersion(
              txDb,
              tenantId,
              diff.map((change) => change.userId),
              now,
            );
            await incrementGroupPermissionVersion(txDb, tenantId, groupId);
          }
        }

        if (nextPermissionsBySpace !== undefined) {
          const currentPermissionsBySpace = await getGroupSpacePermissionMap(
            txDb,
            tenantId,
            groupId,
          );
          const diff = diffGroupSpacePermissions(
            groupId,
            currentPermissionsBySpace,
            nextPermissionsBySpace,
          );
          permissionChanges.push(...diff);
          if (diff.length > 0) {
            await replaceGroupSpacePermissions(txDb, {
              tenantId,
              groupId,
              permissionsBySpace: nextPermissionsBySpace,
              now,
            });

            for (const change of diff) {
              await incrementSpacePermissionVersion(txDb, tenantId, change.spaceId, now);
              await insertPermissionVersion(txDb, {
                tenantId,
                spaceId: change.spaceId,
                ...(context.actorUserId !== undefined ? { actorUserId: context.actorUserId } : {}),
                changeType: getPermissionChangeType(change),
                groupId,
                oldPermissions: change.oldPermissions,
                newPermissions: change.newPermissions,
                reason: 'group.update',
              });
            }
          }
        }
      });
    } catch (err) {
      if (isUniqueViolation(err, 'groups_tenant_id_name_unique')) {
        throwApiError(ErrorCode.GROUP_NAME_CONFLICT, 'Group name already exists', HttpStatus.CONFLICT);
      }

      throw err;
    }

    for (const change of memberChanges) {
      await this.publishUserPermissionChanged(tenantId, change.userId);
      this.auditService.push({
        tenant_id: tenantId,
        ...(context.actorUserId !== undefined ? { actor_user_id: context.actorUserId } : {}),
        action: AUDIT_EVENTS.USER_GROUP_CHANGE,
        resource_type: 'user',
        resource_id: change.userId,
        metadata_json: {
          group_id: groupId,
          action: change.action,
        },
      });
    }

    for (const change of permissionChanges) {
      await this.publishSpacePermissionChanged(tenantId, change.spaceId);
      this.auditService.push({
        tenant_id: tenantId,
        ...(context.actorUserId !== undefined ? { actor_user_id: context.actorUserId } : {}),
        action: AUDIT_EVENTS.SPACE_PERMISSION_CHANGE,
        resource_type: 'space_permission',
        resource_id: `${change.spaceId}:${change.groupId}`,
        space_id: change.spaceId,
        metadata_json: {
          group_id: change.groupId,
          old_permissions: change.oldPermissions,
          new_permissions: change.newPermissions,
        },
      });
    }

    return this.getGroupResponse(tenantId, groupId);
  }

  async listSpacePermissions(
    spaceId: string,
    context: AdminContext = {},
  ): Promise<SpacePermissionGroupResponse[]> {
    const tenantId = await this.resolveTenantId(context);
    await validateSpaceExists(this.db, tenantId, spaceId);
    return this.getPermissionsForSpace(tenantId, spaceId);
  }

  async replaceSpacePermissions(
    spaceId: string,
    input: ReplaceSpacePermissionsInput,
    context: AdminContext = {},
  ): Promise<SpacePermissionGroupResponse[]> {
    const tenantId = await this.resolveTenantId(context);
    const permissionsByGroup = normalizePermissionsByGroup(input.permissions);
    const groupIds = [...permissionsByGroup.keys()];
    const now = new Date();
    const permissionChanges: PermissionChange[] = [];

    await this.db.transaction(async (tx) => {
      const txDb = tx as GroupDatabase;
      await validateSpaceExists(txDb, tenantId, spaceId);
      await validateGroupsExist(txDb, tenantId, groupIds);

      const currentPermissionsByGroup = await getSpacePermissionMap(txDb, tenantId, spaceId);
      const diff = diffSpaceGroupPermissions(spaceId, currentPermissionsByGroup, permissionsByGroup);
      permissionChanges.push(...diff);
      if (diff.length === 0) {
        return;
      }

      await txDb
        .delete(space_permissions)
        .where(and(eq(space_permissions.tenant_id, tenantId), eq(space_permissions.space_id, spaceId)));

      const inserts = permissionRowsFromGroupMap(tenantId, spaceId, permissionsByGroup, now);
      if (inserts.length > 0) {
        await txDb.insert(space_permissions).values(inserts);
      }

      await incrementSpacePermissionVersion(txDb, tenantId, spaceId, now);

      for (const change of diff) {
        await insertPermissionVersion(txDb, {
          tenantId,
          spaceId,
          ...(context.actorUserId !== undefined ? { actorUserId: context.actorUserId } : {}),
          changeType: getPermissionChangeType(change),
          groupId: change.groupId,
          oldPermissions: change.oldPermissions,
          newPermissions: change.newPermissions,
          reason: 'space.permission.replace',
        });
      }
    });

    if (permissionChanges.length > 0) {
      await this.publishSpacePermissionChanged(tenantId, spaceId);
    }

    for (const change of permissionChanges) {
      this.auditService.push({
        tenant_id: tenantId,
        ...(context.actorUserId !== undefined ? { actor_user_id: context.actorUserId } : {}),
        action: AUDIT_EVENTS.SPACE_PERMISSION_CHANGE,
        resource_type: 'space_permission',
        resource_id: `${spaceId}:${change.groupId}`,
        space_id: spaceId,
        metadata_json: {
          group_id: change.groupId,
          old_permissions: change.oldPermissions,
          new_permissions: change.newPermissions,
        },
      });
    }

    return this.getPermissionsForSpace(tenantId, spaceId);
  }

  private async getGroupResponse(tenantId: string, groupId: string): Promise<AdminGroupResponse> {
    const group = await findGroupById(this.db, tenantId, groupId);
    if (group === undefined) {
      throwApiError(ErrorCode.GROUP_NOT_FOUND, 'Group not found', HttpStatus.NOT_FOUND);
    }

    const memberCounts = await this.getMemberCounts(tenantId, [groupId]);
    const spacesByGroup = await this.getSpacesByGroup(tenantId, [groupId]);
    return toAdminGroupResponse(group, memberCounts, spacesByGroup);
  }

  private async getMemberCounts(tenantId: string, groupIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (groupIds.length === 0) {
      return counts;
    }

    const rows = await this.db
      .select({
        group_id: group_members.group_id,
        member_count: count(group_members.user_id),
      })
      .from(group_members)
      .where(and(eq(group_members.tenant_id, tenantId), inArray(group_members.group_id, groupIds)))
      .groupBy(group_members.group_id);

    for (const row of rows) {
      counts.set(row.group_id, normalizeCount(row.member_count));
    }

    return counts;
  }

  private async getSpacesByGroup(
    tenantId: string,
    groupIds: string[],
  ): Promise<Map<string, GroupSpacePermissionsResponse[]>> {
    const spacesByGroup = new Map<string, GroupSpacePermissionsResponse[]>();
    if (groupIds.length === 0) {
      return spacesByGroup;
    }

    const rows = await this.db
      .select({
        group_id: space_permissions.group_id,
        space_id: space_permissions.space_id,
        permission: space_permissions.permission,
      })
      .from(space_permissions)
      .where(and(eq(space_permissions.tenant_id, tenantId), inArray(space_permissions.group_id, groupIds)))
      .orderBy(asc(space_permissions.space_id), asc(space_permissions.permission));

    const permissionsByGroupSpace = new Map<string, Map<string, string[]>>();
    for (const row of rows) {
      const bySpace = permissionsByGroupSpace.get(row.group_id) ?? new Map<string, string[]>();
      const permissions = bySpace.get(row.space_id) ?? [];
      permissions.push(row.permission);
      bySpace.set(row.space_id, permissions);
      permissionsByGroupSpace.set(row.group_id, bySpace);
    }

    for (const [groupId, bySpace] of permissionsByGroupSpace) {
      spacesByGroup.set(
        groupId,
        [...bySpace.entries()].map(([spaceId, permissions]) => ({
          space_id: spaceId,
          permissions,
        })),
      );
    }

    return spacesByGroup;
  }

  private async getPermissionsForSpace(
    tenantId: string,
    spaceId: string,
  ): Promise<SpacePermissionGroupResponse[]> {
    const rows = await this.db
      .select({
        group_id: groups.id,
        name: groups.name,
        permission: space_permissions.permission,
      })
      .from(space_permissions)
      .innerJoin(
        groups,
        and(eq(groups.tenant_id, space_permissions.tenant_id), eq(groups.id, space_permissions.group_id)),
      )
      .where(and(eq(space_permissions.tenant_id, tenantId), eq(space_permissions.space_id, spaceId)))
      .orderBy(asc(groups.name), asc(space_permissions.permission));

    const byGroup = new Map<string, SpacePermissionGroupResponse>();
    for (const row of rows) {
      const entry = byGroup.get(row.group_id) ?? {
        group_id: row.group_id,
        name: row.name,
        permissions: [],
      };
      entry.permissions.push(row.permission);
      byGroup.set(row.group_id, entry);
    }

    return [...byGroup.values()];
  }

  private async resolveTenantId(context: AdminContext): Promise<string> {
    if (context.tenantId !== undefined && context.tenantId.trim().length > 0) {
      return context.tenantId.trim();
    }

    const configuredTenantId = process.env.DEFAULT_TENANT_ID;
    if (configuredTenantId !== undefined && configuredTenantId.trim().length > 0) {
      return configuredTenantId.trim();
    }

    const [tenant] = await this.db.select({ id: tenants.id }).from(tenants).limit(1);
    if (tenant === undefined) {
      throw new Error('No tenant configured');
    }

    return tenant.id;
  }

  private async publishSpacePermissionChanged(tenantId: string, spaceId: string): Promise<void> {
    await this.publishRedisEvent(`permission_changed:${spaceId}`, JSON.stringify({ tenant_id: tenantId }));
  }

  private async publishUserPermissionChanged(tenantId: string, userId: string): Promise<void> {
    await this.publishRedisEvent(`user_permission_changed:${userId}`, JSON.stringify({ tenant_id: tenantId }));
  }

  private async publishRedisEvent(channel: string, message: string): Promise<void> {
    try {
      await this.redis?.publish(channel, message);
    } catch (err) {
      getApiLogger().warn({ err, redis_channel: channel }, 'Redis publish failed');
    }
  }
}

function buildGroupOrder(sort: string): SQL {
  const parsed = parseSortSafely(sort);
  const columns = {
    created_at: groups.created_at,
    name: groups.name,
  } as const;
  const column = columns[parsed.field as keyof typeof columns];

  if (column === undefined) {
    throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid sort field', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  return parsed.direction === 'desc' ? desc(column) : asc(column);
}

function parseSortSafely(sort: string): ReturnType<typeof parseSortField> {
  try {
    return parseSortField(sort);
  } catch {
    throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid sort field', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

function buildGroupUpdateValues(
  existing: GroupRow,
  input: UpdateGroupInput,
):
  | {
      name?: string;
      description?: string;
    }
  | undefined {
  const updateValues: {
    name?: string;
    description?: string;
  } = {};

  if (input.name !== undefined && input.name.trim() !== existing.name) {
    updateValues.name = input.name.trim();
  }

  if (input.description !== undefined && input.description.trim() !== (existing.description ?? '')) {
    updateValues.description = input.description.trim();
  }

  return Object.keys(updateValues).length > 0 ? updateValues : undefined;
}

async function validateUsersExist(
  db: GroupDatabase,
  tenantId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenant_id, tenantId), inArray(users.id, userIds)));

  if (rows.length !== userIds.length) {
    throwApiError(ErrorCode.USER_NOT_FOUND, 'User not found', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

async function validateGroupsExist(
  db: GroupDatabase,
  tenantId: string,
  groupIds: string[],
): Promise<void> {
  if (groupIds.length === 0) {
    return;
  }

  const rows = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.tenant_id, tenantId), inArray(groups.id, groupIds)));

  if (rows.length !== groupIds.length) {
    throwApiError(ErrorCode.GROUP_NOT_FOUND, 'Group not found', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

async function validateSpacesExist(
  db: GroupDatabase,
  tenantId: string,
  spaceIds: string[],
): Promise<void> {
  if (spaceIds.length === 0) {
    return;
  }

  const rows = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.tenant_id, tenantId), inArray(spaces.id, spaceIds)));

  if (rows.length !== spaceIds.length) {
    throwApiError(ErrorCode.SPACE_NOT_FOUND, 'Space not found', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

async function validateSpaceExists(
  db: GroupDatabase,
  tenantId: string,
  spaceId: string,
): Promise<void> {
  const [space] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.id, spaceId)))
    .limit(1);

  if (space === undefined) {
    throwApiError(ErrorCode.SPACE_NOT_FOUND, 'Space not found', HttpStatus.NOT_FOUND);
  }
}

async function findGroupById(
  db: GroupDatabase,
  tenantId: string,
  groupId: string,
): Promise<GroupRow | undefined> {
  const [group] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.tenant_id, tenantId), eq(groups.id, groupId)))
    .limit(1);

  return group;
}

async function getGroupMemberIds(
  db: GroupDatabase,
  tenantId: string,
  groupId: string,
): Promise<string[]> {
  const rows = await db
    .select({ user_id: group_members.user_id })
    .from(group_members)
    .where(and(eq(group_members.tenant_id, tenantId), eq(group_members.group_id, groupId)));

  return rows.map((row) => row.user_id);
}

async function replaceGroupMembers(
  db: GroupDatabase,
  tenantId: string,
  groupId: string,
  memberIds: string[],
  now: Date,
): Promise<void> {
  await db
    .delete(group_members)
    .where(and(eq(group_members.tenant_id, tenantId), eq(group_members.group_id, groupId)));

  if (memberIds.length === 0) {
    return;
  }

  await db.insert(group_members).values(
    memberIds.map((userId) => ({
      tenant_id: tenantId,
      group_id: groupId,
      user_id: userId,
      created_at: now,
    })),
  );
}

async function replaceGroupSpacePermissions(
  db: GroupDatabase,
  input: {
    tenantId: string;
    groupId: string;
    permissionsBySpace: Map<string, string[]>;
    now: Date;
  },
): Promise<void> {
  await db
    .delete(space_permissions)
    .where(
      and(
        eq(space_permissions.tenant_id, input.tenantId),
        eq(space_permissions.group_id, input.groupId),
      ),
    );

  const inserts = permissionRowsFromSpaceMap(
    input.tenantId,
    input.groupId,
    input.permissionsBySpace,
    input.now,
  );
  if (inserts.length > 0) {
    await db.insert(space_permissions).values(inserts);
  }
}

async function getGroupSpacePermissionMap(
  db: GroupDatabase,
  tenantId: string,
  groupId: string,
): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      space_id: space_permissions.space_id,
      permission: space_permissions.permission,
    })
    .from(space_permissions)
    .where(and(eq(space_permissions.tenant_id, tenantId), eq(space_permissions.group_id, groupId)));

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const permissions = map.get(row.space_id) ?? [];
    permissions.push(row.permission);
    map.set(row.space_id, permissions);
  }

  return normalizePermissionMap(map);
}

async function getSpacePermissionMap(
  db: GroupDatabase,
  tenantId: string,
  spaceId: string,
): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      group_id: space_permissions.group_id,
      permission: space_permissions.permission,
    })
    .from(space_permissions)
    .where(and(eq(space_permissions.tenant_id, tenantId), eq(space_permissions.space_id, spaceId)));

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const permissions = map.get(row.group_id) ?? [];
    permissions.push(row.permission);
    map.set(row.group_id, permissions);
  }

  return normalizePermissionMap(map);
}

async function incrementUsersPermissionVersion(
  db: GroupDatabase,
  tenantId: string,
  userIds: string[],
  now: Date,
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  await db
    .update(users)
    .set({
      permission_version: sql<number>`${users.permission_version} + 1`,
      updated_at: now,
    })
    .where(and(eq(users.tenant_id, tenantId), inArray(users.id, userIds)));
}

async function incrementGroupPermissionVersion(
  db: GroupDatabase,
  tenantId: string,
  groupId: string,
): Promise<void> {
  await db
    .update(groups)
    .set({
      permission_version: sql<number>`${groups.permission_version} + 1`,
    })
    .where(and(eq(groups.tenant_id, tenantId), eq(groups.id, groupId)));
}

async function incrementSpacePermissionVersion(
  db: GroupDatabase,
  tenantId: string,
  spaceId: string,
  now: Date,
): Promise<void> {
  await db
    .update(spaces)
    .set({
      permission_version: sql<number>`${spaces.permission_version} + 1`,
      updated_at: now,
    })
    .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.id, spaceId)));
}

async function insertPermissionVersion(
  db: GroupDatabase,
  input: {
    tenantId: string;
    spaceId: string;
    actorUserId?: string;
    changeType: string;
    groupId: string;
    oldPermissions: string[];
    newPermissions: string[];
    reason: string;
  },
): Promise<void> {
  await db.insert(permission_versions).values({
    id: randomUUID(),
    tenant_id: input.tenantId,
    space_id: input.spaceId,
    ...(input.actorUserId !== undefined ? { actor_user_id: input.actorUserId } : {}),
    change_type: input.changeType,
    subject_type: 'group',
    subject_id: input.groupId,
    old_permissions_json: input.oldPermissions,
    new_permissions_json: input.newPermissions,
    reason: input.reason,
  });
}

function diffMembers(current: string[], next: string[]): MemberChange[] {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  const changes: MemberChange[] = [];

  for (const userId of nextSet) {
    if (!currentSet.has(userId)) {
      changes.push({ userId, action: 'added' });
    }
  }

  for (const userId of currentSet) {
    if (!nextSet.has(userId)) {
      changes.push({ userId, action: 'removed' });
    }
  }

  return changes;
}

function diffGroupSpacePermissions(
  groupId: string,
  current: Map<string, string[]>,
  next: Map<string, string[]>,
): PermissionChange[] {
  const spaceIds = new Set([...current.keys(), ...next.keys()]);
  const changes: PermissionChange[] = [];

  for (const spaceId of spaceIds) {
    const oldPermissions = current.get(spaceId) ?? [];
    const newPermissions = next.get(spaceId) ?? [];
    if (!samePermissions(oldPermissions, newPermissions)) {
      changes.push({ spaceId, groupId, oldPermissions, newPermissions });
    }
  }

  return changes;
}

function diffSpaceGroupPermissions(
  spaceId: string,
  current: Map<string, string[]>,
  next: Map<string, string[]>,
): PermissionChange[] {
  const groupIds = new Set([...current.keys(), ...next.keys()]);
  const changes: PermissionChange[] = [];

  for (const groupId of groupIds) {
    const oldPermissions = current.get(groupId) ?? [];
    const newPermissions = next.get(groupId) ?? [];
    if (!samePermissions(oldPermissions, newPermissions)) {
      changes.push({ spaceId, groupId, oldPermissions, newPermissions });
    }
  }

  return changes;
}

function samePermissions(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((permission) => rightSet.has(permission));
}

function getPermissionChangeType(change: PermissionChange): string {
  if (change.oldPermissions.length === 0 && change.newPermissions.length > 0) {
    return 'grant';
  }

  if (change.oldPermissions.length > 0 && change.newPermissions.length === 0) {
    return 'revoke';
  }

  return 'replace';
}

function normalizePermissionsBySpace(input: SpacePermissionInput[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const item of input) {
    const spaceId = item.space_id.trim();
    if (spaceId.length === 0) {
      continue;
    }

    map.set(spaceId, normalizePermissionList([...(map.get(spaceId) ?? []), ...item.permissions]));
  }

  return map;
}

function normalizePermissionsByGroup(
  input: ReplaceSpacePermissionsInput['permissions'],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const item of input) {
    const groupId = item.group_id.trim();
    if (groupId.length === 0) {
      continue;
    }

    map.set(groupId, normalizePermissionList([...(map.get(groupId) ?? []), ...item.permissions]));
  }

  return map;
}

function normalizePermissionMap(input: Map<string, string[]>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [id, permissions] of input) {
    map.set(id, normalizePermissionList(permissions));
  }

  return map;
}

function normalizePermissionList(permissions: string[]): string[] {
  const normalized = permissions
    .map((permission) => permission.trim())
    .filter((permission) => permission.length > 0);

  for (const permission of normalized) {
    if (!isPermissionPoint(permission)) {
      throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid permission', HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }

  return [...new Set(normalized)].sort();
}

function permissionRowsFromSpaceMap(
  tenantId: string,
  groupId: string,
  permissionsBySpace: Map<string, string[]>,
  now: Date,
): Array<typeof space_permissions.$inferInsert> {
  const rows: Array<typeof space_permissions.$inferInsert> = [];

  for (const [spaceId, permissions] of permissionsBySpace) {
    for (const permission of permissions) {
      rows.push({
        id: randomUUID(),
        tenant_id: tenantId,
        space_id: spaceId,
        group_id: groupId,
        permission,
        created_at: now,
      });
    }
  }

  return rows;
}

function permissionRowsFromGroupMap(
  tenantId: string,
  spaceId: string,
  permissionsByGroup: Map<string, string[]>,
  now: Date,
): Array<typeof space_permissions.$inferInsert> {
  const rows: Array<typeof space_permissions.$inferInsert> = [];

  for (const [groupId, permissions] of permissionsByGroup) {
    for (const permission of permissions) {
      rows.push({
        id: randomUUID(),
        tenant_id: tenantId,
        space_id: spaceId,
        group_id: groupId,
        permission,
        created_at: now,
      });
    }
  }

  return rows;
}

function toAdminGroupResponse(
  row: GroupRow,
  memberCounts: Map<string, number>,
  spacesByGroup: Map<string, GroupSpacePermissionsResponse[]>,
): AdminGroupResponse {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    member_count: memberCounts.get(row.id) ?? 0,
    spaces: spacesByGroup.get(row.id) ?? [],
    created_at: row.created_at,
  };
}

function normalizeIdList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalizePage(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : DEFAULT_PAGE;
}

function normalizePerPage(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined || value < 1) {
    return DEFAULT_PER_PAGE;
  }

  return Math.min(value, MAX_PER_PAGE);
}

function normalizeCount(value: unknown): number {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (!isRecord(err)) {
    return false;
  }

  return err.code === '23505' && (err.constraint === undefined || err.constraint === constraint);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function throwApiError(code: ErrorCode, message: string, status: HttpStatus): never {
  throw new HttpException({ code, message }, status);
}
