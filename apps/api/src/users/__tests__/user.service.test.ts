import { ErrorCode } from '@cherrygraph/shared';
import { describe, expect, it } from 'vitest';

import { AUDIT_EVENTS } from '../../audit/audit-events.js';
import { UserService } from '../user.service.js';
import {
  TEST_ACTOR_ID,
  TEST_GROUP_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  ScriptedDb,
  createAuditMock,
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
    const { service, db, audit } = createServiceContext();
    db.queueSelect([createUserRow({ role: 'viewer' })]);
    db.queueUpdate([createUserRow({ role: 'editor' })]);
    db.queueSelect([{ user_id: TEST_USER_ID, group_id: TEST_GROUP_ID }]);

    const result = await service.updateUser(TEST_USER_ID, { role: 'editor' }, createContext());

    expect(result.role).toBe('editor');
    expect(requireRecord(db.updates[0]?.value).role).toBe('editor');
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_USER_UPDATE,
        resource_id: TEST_USER_ID,
      }),
    );
  });

  it('disables a user, revokes sessions, and records admin.user.disable', async () => {
    const { service, db, audit, session } = createServiceContext();
    db.queueSelect([createUserRow({ status: 'active' })]);
    db.queueUpdate([createUserRow({ status: 'disabled' })]);
    db.queueSelect([]);

    await service.updateUser(TEST_USER_ID, { status: 'disabled' }, createContext());

    expect(session.revokeAllActiveSessionsForUser).toHaveBeenCalledWith(
      TEST_TENANT_ID,
      TEST_USER_ID,
      expect.any(Date),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_USER_DISABLE,
        resource_id: TEST_USER_ID,
      }),
    );
  });

  it('re-enables a user and records admin.user.update', async () => {
    const { service, db, audit, session } = createServiceContext();
    db.queueSelect([createUserRow({ status: 'disabled' })]);
    db.queueUpdate([createUserRow({ status: 'active' })]);
    db.queueSelect([]);

    const result = await service.updateUser(TEST_USER_ID, { status: 'active' }, createContext());

    expect(result.status).toBe('active');
    expect(session.revokeAllActiveSessionsForUser).not.toHaveBeenCalled();
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
});

function createServiceContext(): {
  service: UserService;
  db: ScriptedDb;
  audit: ReturnType<typeof createAuditMock>;
  session: ReturnType<typeof createSessionMock>;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  const session = createSessionMock();
  const service = new UserService(db.asDrizzle(), audit.service, session.service);

  return { service, db, audit, session };
}

function createContext(): { tenantId: string; actorUserId: string } {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_ACTOR_ID,
  };
}
