import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ROLES, hashPassword, normalizeRole, type Role } from '@cherrygraph/auth-core';
import { ErrorCode, group_members, groups, sessions, space_permissions, tenants, users } from '@cherrygraph/shared';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
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
import { throwApiError } from '../common/errors/api-error.js';
import { getApiLogger } from '../common/logger/logger.module.js';
import { REDIS_CLIENT } from '../common/redis/redis.module.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { SessionService } from '../auth/session.service.js';
import { BridgeQueueService } from '../bridge/bridge-queue.service.js';
import { enqueuePermissionSync } from '../bridge/bridge-permission-hooks.js';

type UserDatabase = NodePgDatabase;
type UserRow = typeof users.$inferSelect;

type RedisPublisher = {
  publish: (channel: string, message: string) => Promise<number>;
};

export type AdminContext = {
  tenantId?: string;
  actorUserId?: string;
  actorRole?: string;
};

export type ListUsersInput = {
  page?: number;
  per_page?: number;
  sort?: string;
  role?: string;
  status?: string;
  search?: string;
};

export type CreateUserInput = {
  email: string;
  name: string;
  password: string;
  role: string;
  groups?: string[];
};

export type UpdateUserInput = {
  display_name?: string;
  role?: string;
  status?: string;
};

export type AdminUserResponse = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  groups: string[];
  last_login_at: Date | null;
  created_at: Date;
};

export type AdminUserIdentity = {
  id: string;
  email: string;
  name: string;
  role: string;
};

type UserSortField = keyof Pick<
  typeof users,
  'created_at' | 'email' | 'display_name' | 'role' | 'status' | 'last_login_at'
>;

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;
const VALID_STATUSES = new Set(['active', 'disabled', 'deleted']);
const ROLE_RANK: Record<Role, number> = {
  [ROLES.OWNER]: 6,
  [ROLES.ADMIN]: 5,
  [ROLES.SPACE_ADMIN]: 4,
  [ROLES.EDITOR]: 3,
  [ROLES.VIEWER]: 2,
  [ROLES.AUDITOR]: 1,
};

@Injectable()
export class UserService {
  constructor(
    @Inject(DRIZZLE) private readonly db: UserDatabase,
    private readonly auditService: AuditService,
    private readonly sessionService: SessionService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: RedisPublisher,
    @Optional() private readonly bridgeQueueService?: BridgeQueueService,
  ) {}

  async listUsers(
    input: ListUsersInput = {},
    context: AdminContext = {},
  ): Promise<PaginatedResponse<AdminUserResponse>> {
    const tenantId = await this.resolveTenantId(context);
    const page = normalizePage(input.page);
    const perPage = normalizePerPage(input.per_page);
    const where = buildUserWhere(tenantId, input);
    const order = buildUserOrder(input.sort ?? '-created_at');

    const rows = await this.db
      .select()
      .from(users)
      .where(where)
      .orderBy(order)
      .limit(perPage)
      .offset((page - 1) * perPage);
    const [countRow] = await this.db.select({ total: count() }).from(users).where(where);
    const groupsByUser = await this.getUserGroupIds(
      tenantId,
      rows.map((row) => row.id),
    );

    return paginatedResponse(
      rows.map((row) => toAdminUserResponse(row, groupsByUser.get(row.id) ?? [])),
      buildPaginationMeta(page, perPage, normalizeCount(countRow?.total)),
    );
  }

  async createUser(
    input: CreateUserInput,
    context: AdminContext = {},
  ): Promise<AdminUserResponse> {
    const tenantId = await this.resolveTenantId(context);
    const role = normalizeRoleOrThrow(input.role);
    assertCanAssignRole(context, role);
    const groupIds = normalizeIdList(input.groups ?? []);
    const now = new Date();
    const passwordHash = await hashPassword(input.password);

    try {
      const created = await this.db.transaction(async (tx) => {
        const txDb = tx as UserDatabase;
        await validateGroupsExist(txDb, tenantId, groupIds);

        const [user] = await txDb
          .insert(users)
          .values({
            id: randomUUID(),
            tenant_id: tenantId,
            email: normalizeEmail(input.email),
            display_name: input.name.trim(),
            password_hash: passwordHash,
            role,
            status: 'active',
            created_at: now,
            updated_at: now,
          })
          .returning();

        if (user === undefined) {
          throw new Error('Failed to create user');
        }

        if (groupIds.length > 0) {
          await txDb.insert(group_members).values(
            groupIds.map((groupId) => ({
              tenant_id: tenantId,
              group_id: groupId,
              user_id: user.id,
              created_at: now,
            })),
          );
        }

        return user;
      });

      this.auditService.push({
        tenant_id: tenantId,
        ...(context.actorUserId !== undefined ? { actor_user_id: context.actorUserId } : {}),
        action: AUDIT_EVENTS.ADMIN_USER_CREATE,
        resource_type: 'user',
        resource_id: created.id,
        metadata_json: {
          email: created.email,
          role: created.role,
          groups: groupIds,
        },
      });

      void this.bridgeQueueService?.enqueueUserSyncJob({
        userId: created.id,
        email: created.email,
        name: created.display_name,
        tenantId,
      }).catch((err: unknown) => {
        getApiLogger().warn(
          { err: toSafeErrorMessage(err), user_id: created.id },
          'Docmost user sync enqueue failed',
        );
      });
      this.enqueuePermissionSyncForGroups(tenantId, groupIds);

      return toAdminUserResponse(created, groupIds);
    } catch (err) {
      if (isUniqueViolation(err, 'users_tenant_id_email_unique')) {
        throwApiError(ErrorCode.USER_EMAIL_CONFLICT, 'User email already exists', HttpStatus.CONFLICT);
      }

      throw err;
    }
  }

  async updateUser(
    userId: string,
    input: UpdateUserInput,
    context: AdminContext = {},
  ): Promise<AdminUserResponse> {
    const tenantId = await this.resolveTenantId(context);
    const existing = await findUserById(this.db, tenantId, userId);
    if (existing === undefined || existing.status === 'deleted') {
      throwApiError(ErrorCode.USER_NOT_FOUND, 'User not found', HttpStatus.NOT_FOUND);
    }

    const now = new Date();
    const updateValues: {
      display_name?: string;
      role?: string;
      status?: string;
      permission_version?: SQL<number>;
      updated_at: Date;
    } = {
      updated_at: now,
    };
    const changedFields: string[] = [];

    if (input.display_name !== undefined && input.display_name.trim() !== existing.display_name) {
      updateValues.display_name = input.display_name.trim();
      changedFields.push('display_name');
    }

    if (input.role !== undefined) {
      const role = normalizeRoleOrThrow(input.role);
      if (role !== existing.role) {
        assertCanAssignRole(context, role, {
          userId,
          existingRole: existing.role,
        });
        updateValues.role = role;
        changedFields.push('role');
      }
    }

    if (input.status !== undefined) {
      const status = normalizeStatusOrThrow(input.status);
      if (status !== existing.status) {
        updateValues.status = status;
        changedFields.push('status');
      }
    }

    if (changedFields.length === 0) {
      return toAdminUserResponse(
        existing,
        await this.getUserGroupIds(tenantId, [existing.id]).then((map) => map.get(existing.id) ?? []),
      );
    }

    const permissionSensitiveChange = changedFields.includes('role') || changedFields.includes('status');
    if (permissionSensitiveChange) {
      updateValues.permission_version = sql<number>`${users.permission_version} + 1`;
    }

    const [updated] = await this.db
      .update(users)
      .set(updateValues)
      .where(and(eq(users.tenant_id, tenantId), eq(users.id, userId)))
      .returning();
    const updatedUser =
      updated ??
      ({
        ...existing,
        display_name: updateValues.display_name ?? existing.display_name,
        role: updateValues.role ?? existing.role,
        status: updateValues.status ?? existing.status,
        permission_version: permissionSensitiveChange
          ? existing.permission_version + 1
          : existing.permission_version,
        updated_at: now,
      } satisfies UserRow);

    const disabledTransition = existing.status !== 'disabled' && updatedUser.status === 'disabled';
    if (disabledTransition) {
      await this.sessionService.revokeAllActiveSessionsForUser(tenantId, userId, now);
    }

    if (permissionSensitiveChange) {
      await this.publishUserPermissionChanged(tenantId, userId);
    }

    if (changedFields.includes('status')) {
      this.enqueuePermissionSyncForUserSpaces(tenantId, userId);
    }

    this.auditService.push({
      tenant_id: tenantId,
      ...(context.actorUserId !== undefined ? { actor_user_id: context.actorUserId } : {}),
      action: disabledTransition ? AUDIT_EVENTS.ADMIN_USER_DISABLE : AUDIT_EVENTS.ADMIN_USER_UPDATE,
      resource_type: 'user',
      resource_id: userId,
      metadata_json: {
        changed_fields: changedFields,
        old_status: existing.status,
        new_status: updatedUser.status,
      },
    });

    const groupsByUser = await this.getUserGroupIds(tenantId, [userId]);
    return toAdminUserResponse(updatedUser, groupsByUser.get(userId) ?? []);
  }

  async deleteUser(userId: string, context: AdminContext = {}): Promise<void> {
    const tenantId = await this.resolveTenantId(context);
    const existing = await findUserById(this.db, tenantId, userId);
    if (existing === undefined || existing.status === 'deleted') {
      throwApiError(ErrorCode.USER_NOT_FOUND, 'User not found', HttpStatus.NOT_FOUND);
    }

    if (userId === context.actorUserId) {
      throwApiError(ErrorCode.PERMISSION_DENIED, 'Cannot delete yourself', HttpStatus.FORBIDDEN);
    }

    if (existing.role === ROLES.OWNER) {
      throwApiError(ErrorCode.PERMISSION_DENIED, 'Cannot delete owner', HttpStatus.FORBIDDEN);
    }

    const now = new Date();
    const affectedSpaceIds = await this.getSpaceIdsForUserGroups(tenantId, userId);
    await this.db.transaction(async (tx) => {
      const txDb = tx as UserDatabase;
      const [deleted] = await txDb
        .update(users)
        .set({
          status: 'deleted',
          permission_version: sql<number>`${users.permission_version} + 1`,
          updated_at: now,
        })
        .where(and(eq(users.tenant_id, tenantId), eq(users.id, userId), sql`${users.status} != 'deleted'`))
        .returning();

      if (deleted === undefined) {
        throwApiError(ErrorCode.USER_NOT_FOUND, 'User not found', HttpStatus.NOT_FOUND);
      }

      await txDb
        .delete(group_members)
        .where(and(eq(group_members.tenant_id, tenantId), eq(group_members.user_id, userId)));

      await txDb
        .delete(sessions)
        .where(and(eq(sessions.tenant_id, tenantId), eq(sessions.user_id, userId)));
    });

    await this.publishUserPermissionChanged(tenantId, userId);
    this.enqueuePermissionSyncForSpaces(tenantId, affectedSpaceIds);

    this.auditService.push({
      tenant_id: tenantId,
      ...(context.actorUserId !== undefined ? { actor_user_id: context.actorUserId } : {}),
      action: AUDIT_EVENTS.ADMIN_USER_DELETE,
      resource_type: 'user',
      resource_id: userId,
      metadata_json: {
        old_status: existing.status,
        new_status: 'deleted',
        role: existing.role,
        email: existing.email,
      },
    });
  }

  async findFirstAdminUser(context: AdminContext = {}): Promise<AdminUserIdentity | undefined> {
    const tenantId = await this.resolveTenantId(context);
    const [user] = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.display_name,
        role: users.role,
      })
      .from(users)
      .where(
        and(
          eq(users.tenant_id, tenantId),
          inArray(users.role, [ROLES.OWNER, ROLES.ADMIN]),
          eq(users.status, 'active'),
        ),
      )
      .orderBy(asc(users.created_at))
      .limit(1);

    return user;
  }

  private async getUserGroupIds(tenantId: string, userIds: string[]): Promise<Map<string, string[]>> {
    const groupsByUser = new Map<string, string[]>();
    if (userIds.length === 0) {
      return groupsByUser;
    }

    const rows = await this.db
      .select({
        user_id: group_members.user_id,
        group_id: group_members.group_id,
      })
      .from(group_members)
      .where(and(eq(group_members.tenant_id, tenantId), inArray(group_members.user_id, userIds)));

    for (const row of rows) {
      const groupIds = groupsByUser.get(row.user_id) ?? [];
      groupIds.push(row.group_id);
      groupsByUser.set(row.user_id, groupIds);
    }

    return groupsByUser;
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

  private async publishUserPermissionChanged(tenantId: string, userId: string): Promise<void> {
    const channel = `user_permission_changed:${userId}`;
    try {
      await this.redis?.publish(channel, JSON.stringify({ tenant_id: tenantId }));
    } catch (err) {
      getApiLogger().warn({ err, redis_channel: channel }, 'Redis publish failed');
    }
  }

  private enqueuePermissionSyncForGroups(tenantId: string, groupIds: string[]): void {
    if (this.bridgeQueueService === undefined) {
      return;
    }

    const uniqueGroupIds = [...new Set(groupIds)].filter((groupId) => groupId.length > 0);
    if (uniqueGroupIds.length === 0) {
      return;
    }

    void this.getSpaceIdsForGroups(tenantId, uniqueGroupIds)
      .then((spaceIds) =>
        Promise.all(
          spaceIds.map((spaceId) =>
            enqueuePermissionSync(this.bridgeQueueService as BridgeQueueService, spaceId, tenantId),
          ),
        ),
      )
      .catch((err: unknown) => {
        getApiLogger().warn(
          { err: toSafeErrorMessage(err), group_ids: uniqueGroupIds },
          'Docmost permission sync enqueue failed',
        );
      });
  }

  private enqueuePermissionSyncForUserSpaces(tenantId: string, userId: string): void {
    if (this.bridgeQueueService === undefined) {
      return;
    }

    void this.getSpaceIdsForUserGroups(tenantId, userId)
      .then((spaceIds) => this.enqueuePermissionSyncForSpaces(tenantId, spaceIds))
      .catch((err: unknown) => {
        getApiLogger().warn(
          { err: toSafeErrorMessage(err), user_id: userId },
          'Docmost permission sync enqueue failed',
        );
      });
  }

  private enqueuePermissionSyncForSpaces(tenantId: string, spaceIds: string[]): void {
    if (this.bridgeQueueService === undefined) {
      return;
    }

    const uniqueSpaceIds = [...new Set(spaceIds)].filter((spaceId) => spaceId.length > 0);
    if (uniqueSpaceIds.length === 0) {
      return;
    }

    void Promise.all(
      uniqueSpaceIds.map((spaceId) =>
        enqueuePermissionSync(this.bridgeQueueService as BridgeQueueService, spaceId, tenantId),
      ),
    ).catch((err: unknown) => {
      getApiLogger().warn(
        { err: toSafeErrorMessage(err), space_ids: uniqueSpaceIds },
        'Docmost permission sync enqueue failed',
      );
    });
  }

  private async getSpaceIdsForGroups(tenantId: string, groupIds: string[]): Promise<string[]> {
    if (groupIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .select({ space_id: space_permissions.space_id })
      .from(space_permissions)
      .where(and(eq(space_permissions.tenant_id, tenantId), inArray(space_permissions.group_id, groupIds)));

    return [...new Set(rows.map((row) => row.space_id))];
  }

  private async getSpaceIdsForUserGroups(tenantId: string, userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ space_id: space_permissions.space_id })
      .from(group_members)
      .innerJoin(
        space_permissions,
        and(
          eq(group_members.tenant_id, space_permissions.tenant_id),
          eq(group_members.group_id, space_permissions.group_id),
        ),
      )
      .where(and(eq(group_members.tenant_id, tenantId), eq(group_members.user_id, userId)));

    return [...new Set(rows.map((row) => row.space_id))];
  }
}

function buildUserWhere(tenantId: string, input: ListUsersInput): SQL {
  const conditions: SQL[] = [eq(users.tenant_id, tenantId)];

  if (input.role !== undefined && input.role.trim().length > 0) {
    conditions.push(eq(users.role, normalizeRoleOrThrow(input.role)));
  }

  if (input.status !== undefined && input.status.trim().length > 0) {
    conditions.push(eq(users.status, normalizeStatusOrThrow(input.status)));
  } else {
    conditions.push(sql`${users.status} != 'deleted'`);
  }

  if (input.search !== undefined && input.search.trim().length > 0) {
    const escaped = escapeLikePattern(input.search.trim());
    const searchCondition = or(
      ilike(users.email, `%${escaped}%`),
      ilike(users.display_name, `%${escaped}%`),
    );
    if (searchCondition !== undefined) {
      conditions.push(searchCondition);
    }
  }

  const where = and(...conditions);
  if (where === undefined) {
    throw new Error('Expected user where clause');
  }

  return where;
}

function buildUserOrder(sort: string): SQL {
  const parsed = parseSortSafely(sort);
  const columns = {
    created_at: users.created_at,
    email: users.email,
    display_name: users.display_name,
    name: users.display_name,
    role: users.role,
    status: users.status,
    last_login_at: users.last_login_at,
  } as const;
  const column = columns[parsed.field as keyof typeof columns] as (typeof users)[UserSortField] | undefined;

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

async function validateGroupsExist(
  db: UserDatabase,
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

async function findUserById(
  db: UserDatabase,
  tenantId: string,
  userId: string,
): Promise<UserRow | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.tenant_id, tenantId), eq(users.id, userId)))
    .limit(1);

  return user;
}

function toAdminUserResponse(row: UserRow, groupIds: string[]): AdminUserResponse {
  return {
    id: row.id,
    email: row.email,
    name: row.display_name,
    role: row.role,
    status: row.status,
    groups: groupIds,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
  };
}

function normalizeRoleOrThrow(role: string): Role {
  const normalized = normalizeRole(role);
  if (normalized === undefined) {
    throwApiError(ErrorCode.INVALID_ROLE, 'Invalid role', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  return normalized;
}

function assertCanAssignRole(
  context: AdminContext,
  targetRole: Role,
  options: { userId: string; existingRole: string } | undefined = undefined,
): void {
  const actorRole = normalizeActorRoleOrThrow(context.actorRole);
  if (isHighPrivilegeRole(targetRole) && actorRole !== ROLES.OWNER) {
    throwApiError(ErrorCode.PERMISSION_DENIED, 'Cannot assign requested role', HttpStatus.FORBIDDEN);
  }

  if (ROLE_RANK[actorRole] < ROLE_RANK[targetRole]) {
    throwApiError(ErrorCode.PERMISSION_DENIED, 'Cannot assign requested role', HttpStatus.FORBIDDEN);
  }

  if (
    options !== undefined &&
    context.actorUserId === options.userId &&
    isRoleElevation(options.existingRole, targetRole)
  ) {
    throwApiError(ErrorCode.PERMISSION_DENIED, 'Cannot elevate own role', HttpStatus.FORBIDDEN);
  }
}

function normalizeActorRoleOrThrow(role: string | undefined): Role {
  if (role === undefined) {
    throwApiError(ErrorCode.PERMISSION_DENIED, 'Cannot assign role without actor role', HttpStatus.FORBIDDEN);
  }

  const normalized = normalizeRole(role);
  if (normalized === undefined) {
    throwApiError(ErrorCode.PERMISSION_DENIED, 'Invalid actor role', HttpStatus.FORBIDDEN);
  }

  return normalized;
}

function isHighPrivilegeRole(role: Role): boolean {
  return role === ROLES.OWNER || role === ROLES.ADMIN;
}

function isRoleElevation(existingRole: string, targetRole: Role): boolean {
  const normalizedExistingRole = normalizeRole(existingRole);
  return normalizedExistingRole !== undefined && ROLE_RANK[targetRole] > ROLE_RANK[normalizedExistingRole];
}

function normalizeStatusOrThrow(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (!VALID_STATUSES.has(normalized)) {
    throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid user status', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  return normalized;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toSafeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
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
