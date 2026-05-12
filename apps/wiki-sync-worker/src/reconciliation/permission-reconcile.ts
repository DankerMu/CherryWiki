import { isNotNull } from 'drizzle-orm';

import { spaces } from '@cherrygraph/shared';

import {
  loadSpacePermissionMembers,
  logPermissionAuditEvent,
  type DrizzleDatabase,
  type PermissionMember,
  type PermissionSyncBridgeClient,
} from '../processors/permission-sync.processor.js';

type DatabaseClient = Pick<DrizzleDatabase, 'select' | 'insert'>;

export interface PermissionReconcileBridgeClient extends PermissionSyncBridgeClient {
  getPermissions?(docmostSpaceId: string): Promise<PermissionMember[]>;
}

type ReconcileSpaceRow = {
  spaceId: string;
  tenantId: string;
  docmostSpaceId: string | null;
  permissionVersion: number;
};

export async function reconcilePermissions(
  db: DrizzleDatabase,
  bridgeClient: PermissionReconcileBridgeClient,
): Promise<{ fixed: number; errors: number }> {
  return runPermissionReconcile(db, bridgeClient, false);
}

export async function triggerFullReconcile(
  db: DrizzleDatabase,
  bridgeClient: PermissionReconcileBridgeClient,
): Promise<{ fixed: number; errors: number }> {
  return runPermissionReconcile(db, bridgeClient, true);
}

async function runPermissionReconcile(
  db: DatabaseClient,
  bridgeClient: PermissionReconcileBridgeClient,
  full: boolean,
): Promise<{ fixed: number; errors: number }> {
  const spacesToReconcile = await loadSyncedSpaces(db);
  let fixed = 0;
  let errors = 0;

  for (const space of spacesToReconcile) {
    if (space.docmostSpaceId === null) {
      continue;
    }

    try {
      const expected = await loadSpacePermissionMembers(db, {
        spaceId: space.spaceId,
        tenantId: space.tenantId,
      });
      const actual = await bridgeClient.getPermissions?.(space.docmostSpaceId);
      if (actual !== undefined && permissionMembersEqual(expected, actual)) {
        continue;
      }

      await bridgeClient.pushPermissions(space.docmostSpaceId, expected, {
        version: space.permissionVersion,
        source: 'cherry_api',
      });
      fixed += 1;
      await logPermissionAuditEvent(db, {
        tenantId: space.tenantId,
        spaceId: space.spaceId,
        action: 'permission_consistency_fixed',
        metadata: {
          docmostSpaceId: space.docmostSpaceId,
          expected,
          ...(actual !== undefined ? { actual } : {}),
          full,
        },
      });
    } catch (error) {
      errors += 1;
      await logPermissionAuditEvent(db, {
        tenantId: space.tenantId,
        spaceId: space.spaceId,
        action: 'permission_consistency_failed',
        metadata: {
          docmostSpaceId: space.docmostSpaceId,
          error: errorToJson(error),
          full,
        },
      });
    }
  }

  return { fixed, errors };
}

async function loadSyncedSpaces(db: DatabaseClient): Promise<ReconcileSpaceRow[]> {
  return db
    .select({
      spaceId: spaces.id,
      tenantId: spaces.tenant_id,
      docmostSpaceId: spaces.docmost_space_id,
      permissionVersion: spaces.permission_version,
    })
    .from(spaces)
    .where(isNotNull(spaces.docmost_space_id));
}

function permissionMembersEqual(left: PermissionMember[], right: PermissionMember[]): boolean {
  const normalizedLeft = normalizePermissionMembers(left);
  const normalizedRight = normalizePermissionMembers(right);

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((member, index) => {
    const other = normalizedRight[index];
    return (
      other !== undefined &&
      member.userId === other.userId &&
      member.email === other.email &&
      member.role === other.role
    );
  });
}

function normalizePermissionMembers(members: PermissionMember[]): PermissionMember[] {
  return [...members].sort((left, right) => {
    const userComparison = left.userId.localeCompare(right.userId);
    return userComparison === 0 ? left.email.localeCompare(right.email) : userComparison;
  });
}

function errorToJson(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }

  return { message: String(error) };
}
