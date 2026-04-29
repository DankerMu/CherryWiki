import { ErrorCode, permission_versions, spaces } from '@cherrygraph/shared';
import { describe, expect, it } from 'vitest';

import { AUDIT_EVENTS } from '../../apps/api/src/audit/audit-events.js';
import { GroupService } from '../../apps/api/src/groups/group.service.js';
import { SpaceService, type SpaceContext } from '../../apps/api/src/spaces/space.service.js';
import {
  ScriptedDb,
  TEST_ACTOR_ID,
  TEST_GROUP_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
  createRedisMock,
  createSpaceRow,
  getHttpExceptionCode,
  getRejectedHttpException,
  requireRecord,
} from '../../apps/api/src/users/__tests__/user-group-service-test-utils.js';

describe('permission revocation flow', () => {
  it('removes space access, increments permission version, publishes Redis, and records revocation', async () => {
    const db = new ScriptedDb();
    const audit = createAuditMock();
    const redis = createRedisMock();
    const spaceService = new SpaceService(db.asDrizzle(), audit.service);
    const groupService = new GroupService(db.asDrizzle(), audit.service, redis);

    db.queueSelect([createSpaceRow()]);
    db.queueSelect([{ space_id: TEST_SPACE_ID }]);
    db.queueSelect([{ id: TEST_SPACE_ID }]);
    db.queueSelect([{ group_id: TEST_GROUP_ID, permission: 'space:view' }]);
    db.queueSelect([]);
    db.queueSelect([createSpaceRow({ permission_version: 2 })]);
    db.queueSelect([]);

    await expect(spaceService.getSpace(TEST_SPACE_ID, createViewerContext())).resolves.toMatchObject({
      id: TEST_SPACE_ID,
      name: 'Knowledge',
    });

    await expect(
      groupService.replaceSpacePermissions(
        TEST_SPACE_ID,
        {
          permissions: [],
        },
        createAdminContext(),
      ),
    ).resolves.toEqual([]);

    expect(db.updates.some((operation) => operation.table === spaces && hasPermissionVersionIncrement(operation.value))).toBe(
      true,
    );
    expect(redis.publish).toHaveBeenCalledWith(
      `permission_changed:${TEST_SPACE_ID}`,
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );

    const err = await getRejectedHttpException(spaceService.getSpace(TEST_SPACE_ID, createViewerContext()));
    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.SPACE_NOT_FOUND);

    expect(findInsertedPermissionVersion(db)).toEqual(
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        space_id: TEST_SPACE_ID,
        actor_user_id: TEST_ACTOR_ID,
        change_type: 'revoke',
        subject_type: 'group',
        subject_id: TEST_GROUP_ID,
        old_permissions_json: ['space:view'],
        new_permissions_json: [],
        reason: 'space.permission.replace',
      }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.SPACE_PERMISSION_CHANGE,
        space_id: TEST_SPACE_ID,
      }),
    );
  });
});

function createViewerContext(): SpaceContext {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_USER_ID,
    userId: TEST_USER_ID,
    actorRole: 'viewer',
  };
}

function createAdminContext(): { tenantId: string; actorUserId: string } {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_ACTOR_ID,
  };
}

function hasPermissionVersionIncrement(value: unknown): boolean {
  return 'permission_version' in requireRecord(value);
}

function findInsertedPermissionVersion(db: ScriptedDb): Record<string, unknown> | undefined {
  return db.inserts
    .filter((operation) => operation.table === permission_versions)
    .map((operation) => requireRecord(operation.value))[0];
}
