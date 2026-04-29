import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode, sessions } from '@cherrygraph/shared';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';

import { AUDIT_EVENTS } from '../audit/audit-events.js';
import { AuditService } from '../audit/audit.service.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import type { AuthRequestMetadata } from './auth.service.js';

export type SessionRow = typeof sessions.$inferSelect;

export type SessionSummary = {
  id: string;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
  last_used_at: Date | null;
  is_current: boolean;
};

export type CreateSessionInput = {
  id?: string;
  tenant_id: string;
  user_id: string;
  refresh_token_hash: string;
  expires_at: Date;
  ip?: string;
  user_agent?: string;
  last_used_at?: Date;
};

export type ListSessionsInput = {
  tenantId: string;
  userId: string;
  currentSessionId?: string;
};

export type RevokeSessionInput = {
  tenantId: string;
  userId: string;
  sessionId: string;
  metadata?: AuthRequestMetadata;
};

type SessionDatabase = NodePgDatabase;
type SessionInsert = typeof sessions.$inferInsert;

@Injectable()
export class SessionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: SessionDatabase,
    private readonly auditService: AuditService,
  ) {}

  async createSession(input: CreateSessionInput): Promise<SessionRow> {
    const insert: SessionInsert = {
      id: input.id ?? randomUUID(),
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      refresh_token_hash: input.refresh_token_hash,
      expires_at: input.expires_at,
      ...(input.ip !== undefined ? { ip: input.ip } : {}),
      ...(input.user_agent !== undefined ? { user_agent: input.user_agent } : {}),
      ...(input.last_used_at !== undefined ? { last_used_at: input.last_used_at } : {}),
    };
    const [session] = await this.db.insert(sessions).values(insert).returning();

    if (session === undefined) {
      throw new Error('Failed to create session');
    }

    return session;
  }

  async findSessionById(sessionId: string): Promise<SessionRow | undefined> {
    const [session] = await this.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    return session;
  }

  async listActiveSessions(input: ListSessionsInput): Promise<SessionSummary[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tenant_id, input.tenantId),
          eq(sessions.user_id, input.userId),
          isNull(sessions.revoked_at),
          gt(sessions.expires_at, new Date()),
        ),
      )
      .orderBy(desc(sessions.last_used_at), desc(sessions.created_at));
    const sortedRows = [...rows].sort(compareSessionsByRecentActivity);
    const inferredCurrentSessionId = input.currentSessionId ?? sortedRows[0]?.id;

    return sortedRows.map((session) => ({
      id: session.id,
      ip: session.ip,
      user_agent: session.user_agent,
      created_at: session.created_at,
      last_used_at: session.last_used_at,
      is_current: session.id === inferredCurrentSessionId,
    }));
  }

  async revokeSession(input: RevokeSessionInput): Promise<{ revoked: true }> {
    const session = await this.findOwnedSession(input.tenantId, input.userId, input.sessionId);
    if (session === undefined) {
      throwSessionNotFound();
    }

    await this.revokeSessionById(input.sessionId, new Date());
    this.auditService.push({
      tenant_id: input.tenantId,
      actor_user_id: input.userId,
      action: AUDIT_EVENTS.AUTH_SESSION_REVOKE,
      resource_type: 'session',
      resource_id: input.sessionId,
      ...(input.metadata?.ip !== undefined ? { ip: input.metadata.ip } : {}),
      ...(input.metadata?.user_agent !== undefined ? { user_agent: input.metadata.user_agent } : {}),
      ...(input.metadata?.request_id !== undefined ? { request_id: input.metadata.request_id } : {}),
    });

    return { revoked: true };
  }

  async revokeSessionById(sessionId: string, revokedAt: Date, lastUsedAt?: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({
        revoked_at: revokedAt,
        ...(lastUsedAt !== undefined ? { last_used_at: lastUsedAt } : {}),
      })
      .where(eq(sessions.id, sessionId));
  }

  async revokeAllActiveSessionsForUser(tenantId: string, userId: string, revokedAt: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revoked_at: revokedAt })
      .where(and(eq(sessions.tenant_id, tenantId), eq(sessions.user_id, userId), isNull(sessions.revoked_at)));
  }

  private async findOwnedSession(
    tenantId: string,
    userId: string,
    sessionId: string,
  ): Promise<SessionRow | undefined> {
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.tenant_id, tenantId), eq(sessions.user_id, userId), eq(sessions.id, sessionId)))
      .limit(1);

    return session;
  }
}

function compareSessionsByRecentActivity(left: SessionRow, right: SessionRow): number {
  return getSessionActivityTime(right) - getSessionActivityTime(left);
}

function getSessionActivityTime(session: SessionRow): number {
  return (session.last_used_at ?? session.created_at).getTime();
}

function throwSessionNotFound(): never {
  throw new HttpException(
    {
      code: ErrorCode.SESSION_NOT_FOUND,
      message: 'Session not found',
    },
    HttpStatus.NOT_FOUND,
  );
}
