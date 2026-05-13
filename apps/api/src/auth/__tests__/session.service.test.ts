import { HttpException } from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';
import { describe, expect, it } from 'vitest';

import { AUDIT_EVENTS } from '../../audit/audit-events.js';
import { SessionService } from '../session.service.js';
import {
  FakeDb,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
  createSession,
  getHttpExceptionCode,
  requireRecord,
} from './auth-test-utils.js';

describe('SessionService', () => {
  it('lists active sessions and marks the current session', async () => {
    const { service, db } = createSessionServiceContext();
    db.queueSelect([
      createSession({
        id: 'session-older',
        last_used_at: new Date('2026-04-29T10:00:00.000Z'),
      }),
      createSession({
        id: 'session-current',
        last_used_at: new Date('2026-04-29T12:00:00.000Z'),
      }),
    ]);

    const sessions = await service.listActiveSessions({
      tenantId: TEST_TENANT_ID,
      userId: TEST_USER_ID,
      currentSessionId: 'session-current',
    });

    expect(sessions).toEqual([
      expect.objectContaining({ id: 'session-current', is_current: true }),
      expect.objectContaining({ id: 'session-older', is_current: false }),
    ]);
  });

  it('marks the provided current session even when it is not the most recent', async () => {
    const { service, db } = createSessionServiceContext();
    db.queueSelect([
      createSession({
        id: 'session-older',
        last_used_at: new Date('2026-04-29T10:00:00.000Z'),
      }),
      createSession({
        id: 'session-newer',
        last_used_at: new Date('2026-04-29T12:00:00.000Z'),
      }),
    ]);

    const sessions = await service.listActiveSessions({
      tenantId: TEST_TENANT_ID,
      userId: TEST_USER_ID,
      currentSessionId: 'session-older',
    });

    expect(sessions).toEqual([
      expect.objectContaining({ id: 'session-newer', is_current: false }),
      expect.objectContaining({ id: 'session-older', is_current: true }),
    ]);
  });

  it('falls back to the most recent active session when no current session is provided', async () => {
    const { service, db } = createSessionServiceContext();
    db.queueSelect([
      createSession({
        id: 'session-older',
        last_used_at: new Date('2026-04-29T10:00:00.000Z'),
      }),
      createSession({
        id: 'session-newer',
        last_used_at: new Date('2026-04-29T12:00:00.000Z'),
      }),
    ]);

    const sessions = await service.listActiveSessions({
      tenantId: TEST_TENANT_ID,
      userId: TEST_USER_ID,
    });

    expect(sessions).toEqual([
      expect.objectContaining({ id: 'session-newer', is_current: true }),
      expect.objectContaining({ id: 'session-older', is_current: false }),
    ]);
  });

  it('revokes the oldest active sessions when creating a session above the per-user cap', async () => {
    const { service, db } = createSessionServiceContext();
    db.queueSelect([{ activeCount: 11 }]);
    db.queueSelect([{ id: 'session-oldest' }]);

    const session = await service.createSession({
      id: 'session-new',
      tenant_id: TEST_TENANT_ID,
      user_id: TEST_USER_ID,
      refresh_token_hash: 'new-refresh-token-hash',
      expires_at: new Date(Date.now() + 60 * 60 * 1_000),
    });

    expect(session.id).toBe('session-new');
    expect(requireRecord(db.updates[0]).revoked_at).toBeInstanceOf(Date);
  });

  it('revokes an owned session and records auth.session_revoke', async () => {
    const { service, db, audit } = createSessionServiceContext();
    db.queueSelect([createSession({ id: 'session-1' })]);

    await expect(
      service.revokeSession({
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
        sessionId: 'session-1',
        metadata: { request_id: 'req-session-revoke' },
      }),
    ).resolves.toEqual({ revoked: true });

    expect(requireRecord(db.updates[0]).revoked_at).toBeInstanceOf(Date);
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.AUTH_SESSION_REVOKE,
        actor_user_id: TEST_USER_ID,
        resource_id: 'session-1',
        request_id: 'req-session-revoke',
      }),
    );
  });

  it("returns SESSION_NOT_FOUND when revoking another user's session", async () => {
    const { service, db } = createSessionServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.revokeSession({
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
        sessionId: 'other-session',
      }),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.SESSION_NOT_FOUND);
  });
});

function createSessionServiceContext(): {
  service: SessionService;
  db: FakeDb;
  audit: ReturnType<typeof createAuditMock>;
} {
  const db = new FakeDb();
  const audit = createAuditMock();
  const service = new SessionService(db.asDrizzle(), audit.service);
  return { service, db, audit };
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
