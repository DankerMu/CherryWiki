import { ErrorCode, group_members, groups, space_permissions } from '@cherrygraph/shared';
import { describe, expect, it, vi } from 'vitest';

import { AUDIT_EVENTS } from '../../audit/audit-events.js';
import { getApiLogger } from '../../common/logger/logger.module.js';
import { GroupService } from '../group.service.js';
import {
  TEST_ACTOR_ID,
  TEST_GROUP_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  ScriptedDb,
  createAuditMock,
  createGroupRow,
  createRedisMock,
  createUniqueViolation,
  getHttpExceptionCode,
  getRejectedHttpException,
  requireRecord,
} from '../../users/__tests__/user-group-service-test-utils.js';

describe('GroupService', () => {
  it('lists groups with member counts and space permissions', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createGroupRow()]);
    db.queueSelect([{ total: 1 }]);
    db.queueSelect([{ group_id: TEST_GROUP_ID, member_count: 2 }]);
    db.queueSelect([
      { group_id: TEST_GROUP_ID, space_id: TEST_SPACE_ID, permission: 'space:view' },
      { group_id: TEST_GROUP_ID, space_id: TEST_SPACE_ID, permission: 'space:edit' },
    ]);

    const result = await service.listGroups({ page: 1, per_page: 20 }, createContext());

    expect(result.data).toEqual([
      {
        id: TEST_GROUP_ID,
        name: 'Editors',
        description: 'Editor group',
        member_count: 2,
        spaces: [{ space_id: TEST_SPACE_ID, permissions: ['space:view', 'space:edit'] }],
        created_at: new Date('2026-04-02T00:00:00.000Z'),
      },
    ]);
    expect(result.pagination.total).toBe(1);
  });

  it('creates a group with members and permissions, increments space version, and audits', async () => {
    const { service, db, audit, redis } = createServiceContext();
    db.queueSelect([{ id: TEST_USER_ID }]);
    db.queueSelect([{ id: TEST_SPACE_ID }]);
    db.queueInsert([createGroupRow()]);
    db.queueSelect([createGroupRow()]);
    db.queueSelect([{ group_id: TEST_GROUP_ID, member_count: 1 }]);
    db.queueSelect([{ group_id: TEST_GROUP_ID, space_id: TEST_SPACE_ID, permission: 'space:view' }]);

    const result = await service.createGroup(
      {
        name: 'Editors',
        description: 'Editor group',
        member_ids: [TEST_USER_ID],
        space_permissions: [{ space_id: TEST_SPACE_ID, permissions: ['space:view'] }],
      },
      createContext(),
    );

    expect(result.member_count).toBe(1);
    expect(db.updates.some((operation) => hasPermissionVersionIncrement(operation.value))).toBe(true);
    expect(findInsertedPermissionVersion(db)?.change_type).toBe('grant');
    expect(redis.publish).toHaveBeenCalledWith(
      `permission_changed:${TEST_SPACE_ID}`,
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_GROUP_CREATE,
        resource_id: TEST_GROUP_ID,
      }),
    );
  });

  it('maps duplicate group name to GROUP_NAME_CONFLICT', async () => {
    const { service, db } = createServiceContext();
    db.queueInsertError(createUniqueViolation('groups_tenant_id_name_unique'));

    const err = await getRejectedHttpException(
      service.createGroup({ name: 'Editors' }, createContext()),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.GROUP_NAME_CONFLICT);
  });

  it('updates a group by adding a member with version increment, Redis event, and audit', async () => {
    const { service, db, audit, redis } = createServiceContext();
    db.queueSelect([createGroupRow()]);
    db.queueSelect([{ id: TEST_USER_ID }, { id: 'user-2' }]);
    db.queueSelect([{ user_id: TEST_USER_ID }]);
    db.queueSelect([createGroupRow()]);
    db.queueSelect([{ group_id: TEST_GROUP_ID, member_count: 2 }]);
    db.queueSelect([]);

    await service.updateGroup(
      TEST_GROUP_ID,
      { member_ids: [TEST_USER_ID, 'user-2'] },
      createContext(),
    );

    expect(db.deletes).toHaveLength(1);
    expect(db.inserts.some((operation) => Array.isArray(operation.value))).toBe(true);
    expect(db.updates.filter((operation) => hasPermissionVersionIncrement(operation.value))).toHaveLength(2);
    expect(redis.publish).toHaveBeenCalledWith(
      'user_permission_changed:user-2',
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.USER_GROUP_CHANGE,
        resource_id: 'user-2',
      }),
    );
    expect(findAuditMetadata(audit, AUDIT_EVENTS.USER_GROUP_CHANGE, 'user-2')).toMatchObject({
      action: 'added',
    });
  });

  it('records audit events when Redis publish fails after group member changes', async () => {
    const { service, db, audit, redis } = createServiceContext();
    const warn = vi.spyOn(getApiLogger(), 'warn').mockImplementation(() => undefined);
    redis.publish.mockRejectedValueOnce(new Error('redis down'));
    db.queueSelect([createGroupRow()]);
    db.queueSelect([{ id: TEST_USER_ID }, { id: 'user-2' }]);
    db.queueSelect([{ user_id: TEST_USER_ID }]);
    db.queueSelect([createGroupRow()]);
    db.queueSelect([{ group_id: TEST_GROUP_ID, member_count: 2 }]);
    db.queueSelect([]);

    try {
      await service.updateGroup(
        TEST_GROUP_ID,
        { member_ids: [TEST_USER_ID, 'user-2'] },
        createContext(),
      );

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ redis_channel: 'user_permission_changed:user-2' }),
        'Redis publish failed',
      );
      expect(audit.push).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_EVENTS.USER_GROUP_CHANGE,
          resource_id: 'user-2',
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('updates a group by removing a member without session revocation', async () => {
    const { service, db, audit, redis } = createServiceContext();
    db.queueSelect([createGroupRow()]);
    db.queueSelect([{ id: TEST_USER_ID }]);
    db.queueSelect([{ user_id: TEST_USER_ID }, { user_id: 'user-2' }]);
    db.queueSelect([createGroupRow()]);
    db.queueSelect([{ group_id: TEST_GROUP_ID, member_count: 1 }]);
    db.queueSelect([]);

    await service.updateGroup(TEST_GROUP_ID, { member_ids: [TEST_USER_ID] }, createContext());

    expect(redis.publish).toHaveBeenCalledWith(
      'user_permission_changed:user-2',
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.USER_GROUP_CHANGE,
        resource_id: 'user-2',
      }),
    );
    expect(findAuditMetadata(audit, AUDIT_EVENTS.USER_GROUP_CHANGE, 'user-2')).toMatchObject({
      action: 'removed',
    });
  });

  it('updates a group by adding a space permission with version row, Redis event, and audit', async () => {
    const { service, db, audit, redis } = createServiceContext();
    db.queueSelect([createGroupRow()]);
    db.queueSelect([{ id: TEST_SPACE_ID }]);
    db.queueSelect([]);
    db.queueSelect([createGroupRow()]);
    db.queueSelect([{ group_id: TEST_GROUP_ID, member_count: 0 }]);
    db.queueSelect([{ group_id: TEST_GROUP_ID, space_id: TEST_SPACE_ID, permission: 'space:view' }]);

    await service.updateGroup(
      TEST_GROUP_ID,
      { space_permissions: [{ space_id: TEST_SPACE_ID, permissions: ['space:view'] }] },
      createContext(),
    );

    expect(findInsertedPermissionVersion(db)).toEqual(
      expect.objectContaining({
        change_type: 'grant',
        space_id: TEST_SPACE_ID,
        subject_id: TEST_GROUP_ID,
      }),
    );
    expect(redis.publish).toHaveBeenCalledWith(
      `permission_changed:${TEST_SPACE_ID}`,
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.SPACE_PERMISSION_CHANGE,
        space_id: TEST_SPACE_ID,
      }),
    );
  });

  it('updates a group by removing a space permission with revoke trail', async () => {
    const { service, db, audit, redis } = createServiceContext();
    db.queueSelect([createGroupRow()]);
    db.queueSelect([{ space_id: TEST_SPACE_ID, permission: 'space:view' }]);
    db.queueSelect([createGroupRow()]);
    db.queueSelect([{ group_id: TEST_GROUP_ID, member_count: 0 }]);
    db.queueSelect([]);

    await service.updateGroup(TEST_GROUP_ID, { space_permissions: [] }, createContext());

    expect(findInsertedPermissionVersion(db)).toEqual(
      expect.objectContaining({
        change_type: 'revoke',
        old_permissions_json: ['space:view'],
        new_permissions_json: [],
      }),
    );
    expect(redis.publish).toHaveBeenCalledWith(
      `permission_changed:${TEST_SPACE_ID}`,
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.SPACE_PERMISSION_CHANGE,
        space_id: TEST_SPACE_ID,
      }),
    );
  });

  it('deletes a group, clears members and space permissions, publishes Redis events, and records audit', async () => {
    const { service, db, audit, redis } = createServiceContext();
    db.queueSelect([createGroupRow()]);
    db.queueSelect([{ user_id: TEST_USER_ID }, { user_id: 'user-2' }]);
    db.queueSelect([
      { space_id: TEST_SPACE_ID, permission: 'space:edit' },
      { space_id: TEST_SPACE_ID, permission: 'space:view' },
      { space_id: 'space-2', permission: 'space:view' },
    ]);

    await service.deleteGroup(TEST_GROUP_ID, createContext());

    expect(db.deletes.map((operation) => operation.table)).toEqual([
      group_members,
      space_permissions,
      groups,
    ]);
    expect(db.updates.filter((operation) => hasPermissionVersionIncrement(operation.value))).toHaveLength(3);
    expect(findInsertedPermissionVersions(db)).toEqual([
      expect.objectContaining({
        change_type: 'group_deleted',
        space_id: TEST_SPACE_ID,
        subject_id: TEST_GROUP_ID,
        old_permissions_json: ['space:edit', 'space:view'],
        new_permissions_json: [],
      }),
      expect.objectContaining({
        change_type: 'group_deleted',
        space_id: 'space-2',
        subject_id: TEST_GROUP_ID,
        old_permissions_json: ['space:view'],
        new_permissions_json: [],
      }),
    ]);
    expect(redis.publish).toHaveBeenCalledWith(
      `permission_changed:${TEST_SPACE_ID}`,
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(redis.publish).toHaveBeenCalledWith(
      'permission_changed:space-2',
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(redis.publish).toHaveBeenCalledWith(
      `user_permission_changed:${TEST_USER_ID}`,
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(redis.publish).toHaveBeenCalledWith(
      'user_permission_changed:user-2',
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_GROUP_DELETE,
        resource_type: 'group',
        resource_id: TEST_GROUP_ID,
        metadata_json: {
          groupId: TEST_GROUP_ID,
          groupName: 'Editors',
          memberCount: 2,
        },
      }),
    );
  });

  it('deletes an empty group with 0 members and 0 permissions', async () => {
    const { service, db, audit, redis } = createServiceContext();
    db.queueSelect([createGroupRow()]);
    db.queueSelect([]);
    db.queueSelect([]);

    await service.deleteGroup(TEST_GROUP_ID, createContext());

    expect(db.deletes.map((operation) => operation.table)).toEqual([
      group_members,
      space_permissions,
      groups,
    ]);
    expect(db.updates).toHaveLength(0);
    expect(findInsertedPermissionVersions(db)).toEqual([]);
    expect(redis.publish).not.toHaveBeenCalled();
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_GROUP_DELETE,
        resource_id: TEST_GROUP_ID,
        metadata_json: {
          groupId: TEST_GROUP_ID,
          groupName: 'Editors',
          memberCount: 0,
        },
      }),
    );
  });

  it('throws 404 when deleting a group that does not exist', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(service.deleteGroup('missing-group', createContext()));

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.GROUP_NOT_FOUND);
    expect(db.deletes).toHaveLength(0);
    expect(audit.push).not.toHaveBeenCalled();
  });

  it('returns GROUP_NOT_FOUND when updating a missing group', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.updateGroup('missing-group', { name: 'Missing' }, createContext()),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.GROUP_NOT_FOUND);
  });
});

function createServiceContext(): {
  service: GroupService;
  db: ScriptedDb;
  audit: ReturnType<typeof createAuditMock>;
  redis: ReturnType<typeof createRedisMock>;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  const redis = createRedisMock();
  const service = new GroupService(db.asDrizzle(), audit.service, redis);

  return { service, db, audit, redis };
}

function createContext(): { tenantId: string; actorUserId: string } {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_ACTOR_ID,
  };
}

function hasPermissionVersionIncrement(value: unknown): boolean {
  return 'permission_version' in requireRecord(value);
}

function findInsertedPermissionVersion(db: ScriptedDb): Record<string, unknown> | undefined {
  return findInsertedPermissionVersions(db)[0];
}

function findInsertedPermissionVersions(db: ScriptedDb): Record<string, unknown>[] {
  return db.inserts
    .map((operation) => operation.value)
    .filter((value): value is Record<string, unknown> => (
      isRecord(value) && typeof value.change_type === 'string'
    ));
}

function findAuditMetadata(
  audit: ReturnType<typeof createAuditMock>,
  action: string,
  resourceId: string,
): Record<string, unknown> | undefined {
  const entry = audit.push.mock.calls
    .map(([auditEntry]) => auditEntry)
    .find((auditEntry) => auditEntry.action === action && auditEntry.resource_id === resourceId);
  return entry?.metadata_json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
