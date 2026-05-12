import { group_members, ErrorCode, sessions, users } from '@cherrygraph/shared';
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';

import { AUDIT_EVENTS } from '../../audit/audit-events.js';
import { UserService } from '../user.service.js';
import {
  TEST_ACTOR_ID,
  TEST_GROUP_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  ScriptedDb,
  createAuditMock,
  createRedisMock,
  createSessionMock,
  createUniqueViolation,
  createUserRow,
  getHttpExceptionCode,
  getRejectedHttpException,
  requireRecord,
} from './user-group-service-test-utils.js';

describe('UserService', () => {
  it('lists users with role, status, and search filters', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createUserRow({ id: 'user-2', email: 'alice@example.com', display_name: 'Alice' })]);
    db.queueSelect([{ total: 1 }]);
    db.queueSelect([{ user_id: 'user-2', group_id: TEST_GROUP_ID }]);

    const result = await service.listUsers(
      { role: 'viewer', status: 'active', search: 'alice', page: 1, per_page: 10 },
      createContext(),
    );

    expect(result.data).toEqual([
      expect.objectContaining({
        id: 'user-2',
        email: 'alice@example.com',
        name: 'Alice',
        role: 'viewer',
        status: 'active',
        groups: [TEST_GROUP_ID],
      }),
    ]);
    expect(result.pagination).toMatchObject({ page: 1, per_page: 10, total: 1, has_next: false });
  });

  it('excludes deleted users from default list filters', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);
    db.queueSelect([{ total: 0 }]);

    await service.listUsers({}, createContext());

    expect(sqlDebug(db.whereClauses[0])).toContain("!= 'deleted'");
    expect(sqlDebug(db.whereClauses[1])).toContain("!= 'deleted'");
  });

  it('creates a user with groups and records admin.user.create', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([{ id: TEST_GROUP_ID }]);

    const result = await service.createUser(
      {
        email: 'USER@example.com ',
        name: 'Test User',
        password: 'Correct1!',
        role: 'editor',
        groups: [TEST_GROUP_ID],
      },
      createContext(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        email: 'user@example.com',
        name: 'Test User',
        role: 'editor',
        status: 'active',
        groups: [TEST_GROUP_ID],
      }),
    );
    expect(requireRecord(db.inserts[0]?.value).email).toBe('user@example.com');
    expect(Array.isArray(db.inserts[1]?.value)).toBe(true);
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_USER_CREATE,
        tenant_id: TEST_TENANT_ID,
        actor_user_id: TEST_ACTOR_ID,
        resource_type: 'user',
      }),
    );
  });

  it('enqueues user sync after creating a user', async () => {
    const bridgeQueue = {
      enqueueUserSyncJob: vi.fn(() => Promise.resolve()),
    };
    const { service, db } = createServiceContext({ bridgeQueue });

    await service.createUser(
      {
        email: 'USER@example.com ',
        name: 'Test User',
        password: 'Correct1!',
        role: 'editor',
      },
      createContext(),
    );

    const insertedUserId = String(requireRecord(db.inserts[0]?.value).id);
    expect(bridgeQueue.enqueueUserSyncJob).toHaveBeenCalledWith({
      tenantId: TEST_TENANT_ID,
      userId: insertedUserId,
      email: 'user@example.com',
      name: 'Test User',
    });
  });

  it('maps duplicate user email to USER_EMAIL_CONFLICT', async () => {
    const { service, db } = createServiceContext();
    db.queueInsertError(createUniqueViolation('users_tenant_id_email_unique'));

    const err = await getRejectedHttpException(
      service.createUser(
        {
          email: 'user@example.com',
          name: 'Test User',
          password: 'Correct1!',
          role: 'viewer',
        },
        createContext(),
      ),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.USER_EMAIL_CONFLICT);
  });

  it('denies creating users at or above the actor role', async () => {
    const { service, db } = createServiceContext();

    const err = await getRejectedHttpException(
      service.createUser(
        {
          email: 'owner@example.com',
          name: 'Owner User',
          password: 'Correct1!',
          role: 'owner',
        },
        createContext(),
      ),
    );

    expect(err.getStatus()).toBe(403);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
    expect(db.inserts).toHaveLength(0);
  });

  it('rejects missing group ids on create with GROUP_NOT_FOUND', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.createUser(
        {
          email: 'user@example.com',
          name: 'Test User',
          password: 'Correct1!',
          role: 'viewer',
          groups: [TEST_GROUP_ID],
        },
        createContext(),
      ),
    );

    expect(err.getStatus()).toBe(422);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.GROUP_NOT_FOUND);
    expect(db.inserts).toHaveLength(0);
  });

  it('updates a user role and records admin.user.update', async () => {
    const { service, db, audit, redis } = createServiceContext();
    db.queueSelect([createUserRow({ role: 'viewer' })]);
    db.queueUpdate([createUserRow({ role: 'editor' })]);
    db.queueSelect([{ user_id: TEST_USER_ID, group_id: TEST_GROUP_ID }]);

    const result = await service.updateUser(TEST_USER_ID, { role: 'editor' }, createContext());

    expect(result.role).toBe('editor');
    expect(requireRecord(db.updates[0]?.value).role).toBe('editor');
    expect(hasPermissionVersionIncrement(db.updates[0]?.value)).toBe(true);
    expect(redis.publish).toHaveBeenCalledWith(
      `user_permission_changed:${TEST_USER_ID}`,
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_USER_UPDATE,
        resource_id: TEST_USER_ID,
      }),
    );
  });

  it('denies admin promotion to owner', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createUserRow({ role: 'viewer' })]);

    const err = await getRejectedHttpException(
      service.updateUser(TEST_USER_ID, { role: 'owner' }, createContext()),
    );

    expect(err.getStatus()).toBe(403);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
    expect(db.updates).toHaveLength(0);
  });

  it('denies self-role elevation', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createUserRow({ role: 'viewer' })]);

    const err = await getRejectedHttpException(
      service.updateUser(TEST_USER_ID, { role: 'space_admin' }, createContext({ actorUserId: TEST_USER_ID })),
    );

    expect(err.getStatus()).toBe(403);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
    expect(db.updates).toHaveLength(0);
  });

  it('disables a user, revokes sessions, and records admin.user.disable', async () => {
    const { service, db, audit, session, redis } = createServiceContext();
    db.queueSelect([createUserRow({ status: 'active' })]);
    db.queueUpdate([createUserRow({ status: 'disabled' })]);
    db.queueSelect([]);

    await service.updateUser(TEST_USER_ID, { status: 'disabled' }, createContext());

    expect(session.revokeAllActiveSessionsForUser).toHaveBeenCalledWith(
      TEST_TENANT_ID,
      TEST_USER_ID,
      expect.any(Date),
    );
    expect(hasPermissionVersionIncrement(db.updates[0]?.value)).toBe(true);
    expect(redis.publish).toHaveBeenCalledWith(
      `user_permission_changed:${TEST_USER_ID}`,
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_USER_DISABLE,
        resource_id: TEST_USER_ID,
      }),
    );
  });

  it('re-enables a user and records admin.user.update', async () => {
    const { service, db, audit, session, redis } = createServiceContext();
    db.queueSelect([createUserRow({ status: 'disabled' })]);
    db.queueUpdate([createUserRow({ status: 'active' })]);
    db.queueSelect([]);

    const result = await service.updateUser(TEST_USER_ID, { status: 'active' }, createContext());

    expect(result.status).toBe('active');
    expect(session.revokeAllActiveSessionsForUser).not.toHaveBeenCalled();
    expect(hasPermissionVersionIncrement(db.updates[0]?.value)).toBe(true);
    expect(redis.publish).toHaveBeenCalledWith(
      `user_permission_changed:${TEST_USER_ID}`,
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_USER_UPDATE,
        resource_id: TEST_USER_ID,
      }),
    );
  });

  it('returns USER_NOT_FOUND when updating a missing user', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.updateUser('missing-user', { role: 'editor' }, createContext()),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.USER_NOT_FOUND);
  });

  it('deletes a user, clears groups and sessions, publishes Redis, and records admin.user.delete', async () => {
    const { service, db, audit, redis } = createServiceContext();
    db.queueSelect([createUserRow({ status: 'active' })]);
    db.queueUpdate([createUserRow({ status: 'deleted', permission_version: 2 })]);

    await service.deleteUser(TEST_USER_ID, createContext());

    expect(db.updates[0]?.table).toBe(users);
    expect(requireRecord(db.updates[0]?.value)).toMatchObject({ status: 'deleted' });
    expect(hasPermissionVersionIncrement(db.updates[0]?.value)).toBe(true);
    expect(db.deletes.map((operation) => operation.table)).toEqual([group_members, sessions]);
    expect(redis.publish).toHaveBeenCalledWith(
      `user_permission_changed:${TEST_USER_ID}`,
      JSON.stringify({ tenant_id: TEST_TENANT_ID }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_USER_DELETE,
        tenant_id: TEST_TENANT_ID,
        actor_user_id: TEST_ACTOR_ID,
        resource_type: 'user',
        resource_id: TEST_USER_ID,
      }),
    );
  });

  it('denies deleting yourself', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createUserRow({ id: TEST_ACTOR_ID })]);

    const err = await getRejectedHttpException(
      service.deleteUser(TEST_ACTOR_ID, createContext({ actorUserId: TEST_ACTOR_ID })),
    );

    expect(err.getStatus()).toBe(403);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
    expect(db.updates).toHaveLength(0);
  });

  it('denies deleting owner users', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createUserRow({ role: 'owner' })]);

    const err = await getRejectedHttpException(service.deleteUser(TEST_USER_ID, createContext()));

    expect(err.getStatus()).toBe(403);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
    expect(db.updates).toHaveLength(0);
  });

  it('returns USER_NOT_FOUND when deleting a missing user', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(service.deleteUser('missing-user', createContext()));

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.USER_NOT_FOUND);
    expect(db.updates).toHaveLength(0);
  });

  it('returns USER_NOT_FOUND when deleting an already deleted user', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createUserRow({ status: 'deleted' })]);

    const err = await getRejectedHttpException(service.deleteUser(TEST_USER_ID, createContext()));

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.USER_NOT_FOUND);
    expect(db.updates).toHaveLength(0);
  });
});

function createServiceContext(
  overrides: { bridgeQueue?: { enqueueUserSyncJob: ReturnType<typeof vi.fn> } } = {},
): {
  service: UserService;
  db: ScriptedDb;
  audit: ReturnType<typeof createAuditMock>;
  session: ReturnType<typeof createSessionMock>;
  redis: ReturnType<typeof createRedisMock>;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  const session = createSessionMock();
  const redis = createRedisMock();
  const service = new UserService(
    db.asDrizzle(),
    audit.service,
    session.service,
    redis,
    overrides.bridgeQueue as never,
  );

  return { service, db, audit, session, redis };
}

function createContext(
  overrides: Partial<{ tenantId: string; actorUserId: string; actorRole: string }> = {},
): { tenantId: string; actorUserId: string; actorRole: string } {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_ACTOR_ID,
    actorRole: 'admin',
    ...overrides,
  };
}

function hasPermissionVersionIncrement(value: unknown): boolean {
  return 'permission_version' in requireRecord(value);
}

function sqlDebug(value: unknown): string {
  return inspect(value, { depth: 12 });
}
