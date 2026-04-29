import { HttpException } from '@nestjs/common';
import {
  hashPassword,
  signRefreshToken,
  verifyPassword,
  verifyToken,
} from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cherrygraph/auth-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cherrygraph/auth-core')>();
  return {
    ...actual,
    verifyPassword: vi.fn(actual.verifyPassword),
  };
});

import { AUDIT_EVENTS } from '../../audit/audit-events.js';
import { AuthService, hashRefreshToken } from '../auth.service.js';
import { SessionService } from '../session.service.js';
import {
  FakeDb,
  FakeRedis,
  TEST_EMAIL,
  TEST_JWT_SECRET,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
  createAuthenticatedUser,
  createSession,
  createUser,
  getHttpExceptionCode,
  requireRecord,
} from './auth-test-utils.js';

const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

describe('AuthService', () => {
  beforeEach(() => {
    process.env.DEFAULT_TENANT_ID = TEST_TENANT_ID;
    vi.mocked(verifyPassword).mockClear();
  });

  afterEach(() => {
    restoreDefaultTenantId();
  });

  it('logs in a valid user, creates a session, updates last_login_at, and records auth.login', async () => {
    const passwordHash = await hashPassword('Correct1!');
    const { service, db, audit } = createServiceContext();
    db.queueSelect([createUser(passwordHash)]);
    db.queueSelect([{ id: 'group-1', name: 'Editors' }]);

    const result = await service.login(
      { email: 'USER@example.com ', password: 'Correct1!' },
      { ip: '203.0.113.10', user_agent: 'vitest-agent', request_id: 'req-login' },
    );

    expect(result.expires_in).toBe(3600);
    expect(result.user).toEqual({
      id: TEST_USER_ID,
      email: TEST_EMAIL,
      name: 'Test User',
      role: 'editor',
      groups: ['group-1'],
    });
    expect(typeof result.access_token).toBe('string');
    expect(typeof result.refresh_token).toBe('string');

    const accessPayload = await verifyToken(result.access_token, TEST_JWT_SECRET);
    expect(accessPayload).toMatchObject({
      sub: TEST_USER_ID,
      tenant_id: TEST_TENANT_ID,
      email: TEST_EMAIL,
      role: 'editor',
      group_ids: ['group-1'],
      token_use: 'access',
    });

    const insertedSession = requireRecord(db.inserts[0]);
    expect(insertedSession.refresh_token_hash).toBe(hashRefreshToken(result.refresh_token));
    expect(insertedSession.user_id).toBe(TEST_USER_ID);

    const userUpdate = requireRecord(db.updates[0]);
    expect(userUpdate.last_login_at).toBeInstanceOf(Date);

    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.AUTH_LOGIN,
        actor_user_id: TEST_USER_ID,
        tenant_id: TEST_TENANT_ID,
        resource_type: 'session',
        ip: '203.0.113.10',
        user_agent: 'vitest-agent',
        request_id: 'req-login',
      }),
    );
  });

  it('rejects invalid credentials, increments the lockout counter, and records auth.failed_login', async () => {
    const passwordHash = await hashPassword('Correct1!');
    const { service, redis, db, audit } = createServiceContext();
    db.queueSelect([createUser(passwordHash)]);

    const err = await getRejectedHttpException(
      service.login({ email: TEST_EMAIL, password: 'Wrong1!' }),
    );

    expect(err.getStatus()).toBe(401);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.INVALID_CREDENTIALS);
    expect(redis.values.get(`login_fail:${TEST_EMAIL}`)).toBe('1');
    expect(redis.expirations.get(`login_fail:${TEST_EMAIL}`)).toBe(900);
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.AUTH_FAILED_LOGIN,
        metadata_json: {
          email: TEST_EMAIL,
          reason: 'invalid_credentials',
        },
      }),
    );
  });

  it('verifies a dummy password hash before rejecting an unknown email', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);
    const verifyPasswordMock = vi.mocked(verifyPassword);

    const err = await getRejectedHttpException(
      service.login({ email: TEST_EMAIL, password: 'Wrong1!' }),
    );

    expect(err.getStatus()).toBe(401);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.INVALID_CREDENTIALS);
    expect(verifyPasswordMock).toHaveBeenCalledTimes(1);
    expect(verifyPasswordMock.mock.calls[0]?.[0]).toBe('Wrong1!');
    expect(typeof verifyPasswordMock.mock.calls[0]?.[1]).toBe('string');
  });

  it('rejects disabled accounts with ACCOUNT_DISABLED', async () => {
    const passwordHash = await hashPassword('Correct1!');
    const { service, db } = createServiceContext();
    db.queueSelect([createUser(passwordHash, { status: 'disabled' })]);

    const err = await getRejectedHttpException(
      service.login({ email: TEST_EMAIL, password: 'Correct1!' }),
    );

    expect(err.getStatus()).toBe(401);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.ACCOUNT_DISABLED);
  });

  it('returns INVALID_CREDENTIALS on the fifth failed login attempt and ACCOUNT_LOCKED on the sixth', async () => {
    const passwordHash = await hashPassword('Correct1!');
    const { service, redis, db } = createServiceContext();
    redis.values.set(`login_fail:${TEST_EMAIL}`, '4');
    db.queueSelect([createUser(passwordHash)]);

    const err = await getRejectedHttpException(
      service.login({ email: TEST_EMAIL, password: 'Wrong1!' }),
    );

    expect(err.getStatus()).toBe(401);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.INVALID_CREDENTIALS);
    expect(redis.values.get(`login_fail:${TEST_EMAIL}`)).toBe('5');

    const lockedErr = await getRejectedHttpException(
      service.login({ email: TEST_EMAIL, password: 'Wrong1!' }),
    );

    expect(lockedErr.getStatus()).toBe(401);
    expect(getHttpExceptionCode(lockedErr)).toBe(ErrorCode.ACCOUNT_LOCKED);
  });

  it('resets the login failure counter after successful login', async () => {
    const passwordHash = await hashPassword('Correct1!');
    const { service, redis, db } = createServiceContext();
    redis.values.set(`login_fail:${TEST_EMAIL}`, '3');
    db.queueSelect([createUser(passwordHash)]);
    db.queueSelect([]);

    await service.login({ email: TEST_EMAIL, password: 'Correct1!' });

    expect(redis.deletedKeys).toContain(`login_fail:${TEST_EMAIL}`);
  });

  it('refreshes tokens, rotates the session, and records auth.token_refresh', async () => {
    const passwordHash = await hashPassword('Correct1!');
    const oldRefreshToken = await signRefreshToken({ session_id: 'session-old' }, TEST_JWT_SECRET);
    const { service, db, audit } = createServiceContext();
    db.queueSelect([
      createSession({
        id: 'session-old',
        refresh_token_hash: hashRefreshToken(oldRefreshToken),
      }),
    ]);
    db.queueUpdate([
      createSession({
        id: 'session-old',
        refresh_token_hash: hashRefreshToken(oldRefreshToken),
      }),
    ]);
    db.queueSelect([createUser(passwordHash)]);
    db.queueSelect([{ id: 'group-1', name: 'Editors' }]);

    const result = await service.refresh(oldRefreshToken, { request_id: 'req-refresh' });

    expect(result.expires_in).toBe(3600);
    expect(result.refresh_token).not.toBe(oldRefreshToken);
    const newRefreshPayload = await verifyToken(result.refresh_token, TEST_JWT_SECRET);
    const insertedSession = requireRecord(db.inserts[0]);
    expect(newRefreshPayload.session_id).toBe(insertedSession.id);

    const oldSessionUpdate = requireRecord(db.updates[0]);
    expect(oldSessionUpdate.revoked_at).toBeInstanceOf(Date);
    expect(oldSessionUpdate.last_used_at).toBeInstanceOf(Date);
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.AUTH_TOKEN_REFRESH,
        actor_user_id: TEST_USER_ID,
        request_id: 'req-refresh',
      }),
    );
  });

  it('rejects a concurrent second refresh with TOKEN_REVOKED when the old session was already rotated', async () => {
    const oldRefreshToken = await signRefreshToken({ session_id: 'session-old' }, TEST_JWT_SECRET);
    const { service, db } = createServiceContext();
    db.queueSelect([
      createSession({
        id: 'session-old',
        refresh_token_hash: hashRefreshToken(oldRefreshToken),
      }),
    ]);
    db.queueUpdate([]);

    const err = await getRejectedHttpException(service.refresh(oldRefreshToken));

    expect(err.getStatus()).toBe(401);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.TOKEN_REVOKED);
    expect(db.inserts).toHaveLength(0);
  });

  it('rejects malformed refresh tokens with INVALID_REFRESH_TOKEN', async () => {
    const { service } = createServiceContext();

    const err = await getRejectedHttpException(service.refresh('not-a-jwt'));

    expect(err.getStatus()).toBe(401);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.INVALID_REFRESH_TOKEN);
  });

  it('rejects revoked refresh tokens with TOKEN_REVOKED', async () => {
    const refreshToken = await signRefreshToken({ session_id: 'session-revoked' }, TEST_JWT_SECRET);
    const { service, db } = createServiceContext();
    db.queueSelect([
      createSession({
        id: 'session-revoked',
        refresh_token_hash: hashRefreshToken(refreshToken),
        revoked_at: new Date('2026-04-29T12:00:00.000Z'),
      }),
    ]);

    const err = await getRejectedHttpException(service.refresh(refreshToken));

    expect(err.getStatus()).toBe(401);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.TOKEN_REVOKED);
  });

  it('logs out by revoking the supplied refresh token session and recording auth.logout', async () => {
    const refreshToken = await signRefreshToken({ session_id: 'session-logout' }, TEST_JWT_SECRET);
    const { service, db, audit } = createServiceContext();
    db.queueSelect([
      createSession({
        id: 'session-logout',
        refresh_token_hash: hashRefreshToken(refreshToken),
      }),
    ]);

    const result = await service.logout(
      createAuthenticatedUser(),
      { refresh_token: refreshToken },
      { request_id: 'req-logout' },
    );

    expect(result).toEqual({ success: true });
    expect(requireRecord(db.updates[0]).revoked_at).toBeInstanceOf(Date);
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.AUTH_LOGOUT,
        actor_user_id: TEST_USER_ID,
        resource_id: 'session-logout',
        request_id: 'req-logout',
      }),
    );
  });

  it('rejects logout without a refresh token', async () => {
    const { service } = createServiceContext();

    const err = await getRejectedHttpException(service.logout(createAuthenticatedUser()));

    expect(err.getStatus()).toBe(401);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.INVALID_REFRESH_TOKEN);
  });

  it('changes password with the correct current password and records auth.password_change', async () => {
    const passwordHash = await hashPassword('Correct1!');
    const { service, db, audit } = createServiceContext();
    db.queueSelect([createUser(passwordHash)]);

    const result = await service.changePassword(createAuthenticatedUser(), {
      current_password: 'Correct1!',
      new_password: 'Newpass1!',
    });

    expect(result).toEqual({ success: true });
    const update = requireRecord(db.updates[0]);
    expect(await verifyPassword('Newpass1!', String(update.password_hash))).toBe(true);
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.AUTH_PASSWORD_CHANGE,
        actor_user_id: TEST_USER_ID,
        resource_type: 'user',
      }),
    );
  });

  it('rejects password changes with the wrong current password', async () => {
    const passwordHash = await hashPassword('Correct1!');
    const { service, db } = createServiceContext();
    db.queueSelect([createUser(passwordHash)]);

    const err = await getRejectedHttpException(
      service.changePassword(createAuthenticatedUser(), {
        current_password: 'Wrong1!',
        new_password: 'Newpass1!',
      }),
    );

    expect(err.getStatus()).toBe(400);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.INVALID_CURRENT_PASSWORD);
  });

  it('rejects weak new passwords with PASSWORD_TOO_WEAK', async () => {
    const passwordHash = await hashPassword('Correct1!');
    const { service, db } = createServiceContext();
    db.queueSelect([createUser(passwordHash)]);

    const err = await getRejectedHttpException(
      service.changePassword(createAuthenticatedUser(), {
        current_password: 'Correct1!',
        new_password: 'weakpass',
      }),
    );

    expect(err.getStatus()).toBe(422);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.PASSWORD_TOO_WEAK);
  });

  it('returns the current user with groups and highest space roles', async () => {
    const passwordHash = await hashPassword('Correct1!');
    const { service, db } = createServiceContext();
    db.queueSelect([createUser(passwordHash)]);
    db.queueSelect([{ id: 'group-1', name: 'Editors' }]);
    db.queueSelect([
      { id: 'space-1', name: 'Space One', permission: 'space:view' },
      { id: 'space-1', name: 'Space One', permission: 'space:edit' },
      { id: 'space-2', name: 'Space Two', permission: 'space:admin' },
    ]);

    await expect(service.getCurrentUser(createAuthenticatedUser())).resolves.toEqual({
      id: TEST_USER_ID,
      email: TEST_EMAIL,
      name: 'Test User',
      role: 'editor',
      groups: [{ id: 'group-1', name: 'Editors' }],
      spaces: [
        { id: 'space-1', name: 'Space One', role: 'editor' },
        { id: 'space-2', name: 'Space Two', role: 'admin' },
      ],
    });
  });
});

function createServiceContext(): {
  service: AuthService;
  sessionService: SessionService;
  db: FakeDb;
  redis: FakeRedis;
  audit: ReturnType<typeof createAuditMock>;
} {
  const db = new FakeDb();
  const redis = new FakeRedis();
  const audit = createAuditMock();
  const sessionService = new SessionService(db.asDrizzle(), audit.service);
  const service = new AuthService(db.asDrizzle(), sessionService, audit.service, redis, {
    jwtSecret: TEST_JWT_SECRET,
  });

  return { service, sessionService, db, redis, audit };
}

async function getRejectedHttpException(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpException) {
      return err;
    }

    throw err;
  }

  throw new Error('Expected promise to reject with HttpException');
}

function restoreDefaultTenantId(): void {
  if (originalDefaultTenantId === undefined) {
    delete process.env.DEFAULT_TENANT_ID;
    return;
  }

  process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
}
