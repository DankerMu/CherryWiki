import { UnrecoverableError, type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';

import {
  audit_logs,
  group_members,
  space_permissions,
  spaces,
  users,
} from '@cherrygraph/shared';

export type DrizzleDatabase = NodePgDatabase;
type DatabaseClient = Pick<DrizzleDatabase, 'select' | 'insert'>;

export interface PermissionSyncDeps {
  db: DrizzleDatabase;
  bridgeClient: PermissionSyncBridgeClient;
}

export interface PermissionSyncBridgeClient {
  pushPermissions(
    docmostSpaceId: string,
    members: PermissionMember[],
    opts?: PermissionPushOptions,
  ): Promise<void>;
  getPermissions?(docmostSpaceId: string): Promise<PermissionMember[]>;
}

export type PermissionPushOptions = {
  version: number;
  source: 'cherry_api';
};

export interface PermissionMember {
  userId: string;
  email: string;
  role: 'admin' | 'writer' | 'reader';
}

export type PermissionSyncJobData = {
  spaceId: string;
  tenantId?: string;
};

type SpacePermissionRow = {
  userId: string;
  email: string;
  cherryRole: string;
};

type PushSpacePermissionsResult = {
  pushed: boolean;
  tenantId?: string;
  docmostSpaceId?: string;
  version?: number;
  members: PermissionMember[];
};

export function createPermissionSyncProcessor(
  deps: PermissionSyncDeps,
): (job: Job<PermissionSyncJobData>) => Promise<void> {
  return async (job) => {
    const data = readJobData(job.data);

    try {
      await pushSpacePermissions(deps.db, deps.bridgeClient, data);
    } catch (error) {
      if (isHttpStatus(error, 404)) {
        await logPermissionSyncFailure(deps.db, data, error, true);
        throw new UnrecoverableError(
          `Docmost space not found while syncing permissions for Cherry space ${data.spaceId}`,
        );
      }

      if (isFinalAttempt(job)) {
        await logPermissionSyncFailure(deps.db, data, error, false);
      }

      throw error;
    }
  };
}

export function mapCherryRoleToDocmost(cherryRole: string): 'admin' | 'writer' | 'reader' {
  if (cherryRole === 'admin' || cherryRole === 'owner') return 'admin';
  if (cherryRole === 'editor') return 'writer';
  return 'reader';
}

export async function pushSpacePermissions(
  db: DatabaseClient,
  bridgeClient: PermissionSyncBridgeClient,
  data: PermissionSyncJobData,
): Promise<PushSpacePermissionsResult> {
  const space = await loadPermissionSyncSpace(db, data);
  if (space === undefined || space.docmostSpaceId === null) {
    return { pushed: false, members: [] };
  }

  const members = await loadSpacePermissionMembers(db, {
    spaceId: data.spaceId,
    tenantId: space.tenantId,
  });
  await bridgeClient.pushPermissions(space.docmostSpaceId, members, {
    version: space.permissionVersion,
    source: 'cherry_api',
  });

  return {
    pushed: true,
    tenantId: space.tenantId,
    docmostSpaceId: space.docmostSpaceId,
    version: space.permissionVersion,
    members,
  };
}

export async function loadSpacePermissionMembers(
  db: DatabaseClient,
  data: { spaceId: string; tenantId: string },
): Promise<PermissionMember[]> {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      cherryRole: space_permissions.permission,
    })
    .from(space_permissions)
    .innerJoin(
      group_members,
      and(
        eq(space_permissions.tenant_id, group_members.tenant_id),
        eq(space_permissions.group_id, group_members.group_id),
      ),
    )
    .innerJoin(
      users,
      and(eq(group_members.tenant_id, users.tenant_id), eq(group_members.user_id, users.id)),
    )
    .where(
      and(
        eq(space_permissions.tenant_id, data.tenantId),
        eq(space_permissions.space_id, data.spaceId),
      ),
    );

  return collapsePermissionRows(rows);
}

export async function logPermissionAuditEvent(
  db: DatabaseClient,
  input: {
    tenantId: string;
    spaceId: string;
    action: 'bridge.permission_sync_failed' | 'permission_consistency_fixed' | 'permission_consistency_failed';
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(audit_logs).values({
    id: randomUUID(),
    tenant_id: input.tenantId,
    actor_user_id: null,
    action: input.action,
    resource_type: 'space',
    resource_id: input.spaceId,
    space_id: input.spaceId,
    metadata_json: input.metadata,
  });
}

async function loadPermissionSyncSpace(
  db: DatabaseClient,
  data: PermissionSyncJobData,
): Promise<{ tenantId: string; docmostSpaceId: string | null; permissionVersion: number } | undefined> {
  const where =
    data.tenantId === undefined
      ? eq(spaces.id, data.spaceId)
      : and(eq(spaces.id, data.spaceId), eq(spaces.tenant_id, data.tenantId));
  const [space] = await db
    .select({
      tenantId: spaces.tenant_id,
      docmostSpaceId: spaces.docmost_space_id,
      permissionVersion: spaces.permission_version,
    })
    .from(spaces)
    .where(where)
    .limit(1);

  return space;
}

function collapsePermissionRows(rows: SpacePermissionRow[]): PermissionMember[] {
  const membersByUserId = new Map<string, PermissionMember>();

  for (const row of rows) {
    if (row.email.length === 0) {
      continue;
    }

    const role = mapCherryRoleToDocmost(normalizeCherryRole(row.cherryRole));
    const existing = membersByUserId.get(row.userId);
    if (existing !== undefined && roleRank(existing.role) >= roleRank(role)) {
      continue;
    }

    membersByUserId.set(row.userId, {
      userId: row.userId,
      email: row.email,
      role,
    });
  }

  return [...membersByUserId.values()].sort((left, right) => left.email.localeCompare(right.email));
}

function normalizeCherryRole(permission: string): string {
  if (permission === 'space:admin' || permission === 'admin' || permission === 'owner') {
    return 'admin';
  }

  if (
    permission === 'space:edit' ||
    permission === 'wiki:publish' ||
    permission === 'wiki:edit' ||
    permission === 'editor'
  ) {
    return 'editor';
  }

  return permission;
}

function roleRank(role: PermissionMember['role']): number {
  if (role === 'admin') {
    return 3;
  }
  if (role === 'writer') {
    return 2;
  }
  return 1;
}

async function logPermissionSyncFailure(
  db: DatabaseClient,
  data: PermissionSyncJobData,
  error: unknown,
  nonRetryable: boolean,
): Promise<void> {
  const space = await loadPermissionSyncSpace(db, data);
  if (space === undefined) {
    return;
  }

  await logPermissionAuditEvent(db, {
    tenantId: space.tenantId,
    spaceId: data.spaceId,
    action: 'bridge.permission_sync_failed',
    metadata: {
      nonRetryable,
      error: errorToJson(error),
    },
  });
}

function readJobData(data: unknown): PermissionSyncJobData {
  const record = readRecord(data);
  const spaceId = readString(record.spaceId);
  const tenantId = readString(record.tenantId);

  if (spaceId === undefined) {
    throw new Error('permission-sync job is missing spaceId');
  }

  return tenantId === undefined ? { spaceId } : { spaceId, tenantId };
}

function isFinalAttempt(job: Job): boolean {
  const attempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
  return job.attemptsMade + 1 >= attempts;
}

function isHttpStatus(error: unknown, status: number): boolean {
  if (!isRecord(error)) {
    return false;
  }

  return error.status === status || error.statusCode === status;
}

function errorToJson(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(isRecord(error) && typeof error.status === 'number' ? { status: error.status } : {}),
      ...(isRecord(error) && typeof error.statusCode === 'number' ? { statusCode: error.statusCode } : {}),
    };
  }

  return { message: String(error) };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
