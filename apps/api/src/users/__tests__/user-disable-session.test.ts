import { users } from '@cherrygraph/shared';
import { describe, expect, it } from 'vitest';

import { AUDIT_EVENTS } from '../../audit/audit-events.js';
import { UserService } from '../user.service.js';
import {
  ScriptedDb,
  TEST_ACTOR_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
  createRedisMock,
  createSessionMock,
  createUserRow,
  requireRecord,
} from './user-group-service-test-utils.js';

describe('UserService disable session revocation', () => {
  it('revokes active sessions, audits disable, increments permission version, and publishes Redis', async () => {
    const db = new ScriptedDb();
    const audit = createAuditMock();
    const session = createSessionMock();
    const redis = createRedisMock();
    const service = new UserService(db.asDrizzle(), audit.service, session.service, redis);

    db.queueSelect([createUserRow({ status: 'active', permission_version: 7 })]);
    db.queueUpdate([createUserRow({ status: 'disabled', permission_version: 8 })]);
    db.queueSelect([]);

    await service.updateUser(TEST_USER_ID, { status: 'disabled' }, createContext());

    expect(session.revokeAllActiveSessionsForUser).toHaveBeenCalledWith(
      TEST_TENANT_ID,
      TEST_USER_ID,
      expect.any(Date),
    );
    expect(db.updates[0]?.table).toBe(users);
    expect(requireRecord(db.updates[0]?.value)).toHaveProperty('permission_version');
    expect(redis.publish).toHaveBeenCalledWith(
      `user_permission_changed:${TEST_USER_ID}`,
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_USER_DISABLE,
        tenant_id: TEST_TENANT_ID,
        actor_user_id: TEST_ACTOR_ID,
        resource_type: 'user',
        resource_id: TEST_USER_ID,
      }),
    );
  });
});

function createContext(): { tenantId: string; actorUserId: string; actorRole: string } {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_ACTOR_ID,
    actorRole: 'admin',
  };
}
