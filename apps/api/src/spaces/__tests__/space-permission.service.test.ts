import { describe, expect, it } from 'vitest';

import { AUDIT_EVENTS } from '../../audit/audit-events.js';
import { GroupService } from '../../groups/group.service.js';
import {
  TEST_ACTOR_ID,
  TEST_GROUP_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  ScriptedDb,
  createAuditMock,
  createRedisMock,
} from '../../users/__tests__/user-group-service-test-utils.js';

describe('Space permission management', () => {
  it('lists permissions for a space', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([{ id: TEST_SPACE_ID }]);
    db.queueSelect([
      { group_id: TEST_GROUP_ID, name: 'Editors', permission: 'space:view' },
      { group_id: TEST_GROUP_ID, name: 'Editors', permission: 'space:edit' },
    ]);

    await expect(service.listSpacePermissions(TEST_SPACE_ID, createContext())).resolves.toEqual([
      {
        group_id: TEST_GROUP_ID,
        name: 'Editors',
        permissions: ['space:view', 'space:edit'],
      },
    ]);
  });

  it('replaces space permissions to grant a group and publishes invalidation', async () => {
    const { service, db, audit, redis } = createServiceContext();
    db.queueSelect([{ id: TEST_SPACE_ID }]);
    db.queueSelect([{ id: TEST_GROUP_ID }]);
    db.queueSelect([]);
    db.queueSelect([{ group_id: TEST_GROUP_ID, name: 'Editors', permission: 'space:view' }]);

    const result = await service.replaceSpacePermissions(
      TEST_SPACE_ID,
      { permissions: [{ group_id: TEST_GROUP_ID, permissions: ['space:view'] }] },
      createContext(),
    );

    expect(result).toEqual([
      {
        group_id: TEST_GROUP_ID,
        name: 'Editors',
        permissions: ['space:view'],
      },
    ]);
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

  it('replaces space permissions to revoke a group and writes revoke trail', async () => {
    const { service, db, audit, redis } = createServiceContext();
    db.queueSelect([{ id: TEST_SPACE_ID }]);
    db.queueSelect([{ id: TEST_GROUP_ID }]);
    db.queueSelect([{ group_id: TEST_GROUP_ID, permission: 'space:view' }]);
    db.queueSelect([]);

    const result = await service.replaceSpacePermissions(
      TEST_SPACE_ID,
      { permissions: [{ group_id: TEST_GROUP_ID, permissions: [] }] },
      createContext(),
    );

    expect(result).toEqual([]);
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

function findInsertedPermissionVersion(db: ScriptedDb): Record<string, unknown> | undefined {
  for (const operation of db.inserts) {
    if (isRecord(operation.value) && typeof operation.value.change_type === 'string') {
      return operation.value;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
