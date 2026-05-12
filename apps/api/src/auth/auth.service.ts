import { HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import {
  AUTH_CORE_OPTIONS,
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyToken,
  type AuthCoreOptions,
  type AuthenticatedRequestUser,
  type RefreshTokenPayload,
} from '@cherrygraph/auth-core';
import {
  ErrorCode,
  group_members,
  groups,
  sessions,
  space_permissions,
  spaces,
  tenants,
  users,
} from '@cherrygraph/shared';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createHash, randomUUID } from 'node:crypto';

import { AUDIT_EVENTS } from '../audit/audit-events.js';
import { AuditService } from '../audit/audit.service.js';
import { getApiLogger } from '../common/logger/logger.module.js';
import { REDIS_CLIENT } from '../common/redis/redis.module.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { SessionService, type SessionRow } from './session.service.js';

export type AuthRequestMetadata = {
  ip?: string;
  user_agent?: string;
  request_id?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type LoginResponse = {
  access_token: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    groups: string[];
  };
};

export type TokenPairResponse = {
  access_token: string;
  expires_in: number;
};

export type LogoutInput = {
  refreshToken?: string | undefined;
};

export type LoginResult = LoginResponse & {
  refreshToken: string;
};

export type TokenPairResult = TokenPairResponse & {
  refreshToken: string;
};

export type ChangePasswordInput = {
  current_password: string;
  new_password: string;
};

export type CurrentUserResponse = {
  id: string;
  email: string;
  name: string;
  role: string;
  groups: Array<{ id: string; name: string }>;
  spaces: Array<{ id: string; name: string; role: SpaceAccessRole }>;
};

type SpaceAccessRole = 'viewer' | 'editor' | 'admin';
type AuthDatabase = NodePgDatabase;
type AuthRedisStore = {
  get: (key: string) => Promise<string | null>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  del: (key: string) => Promise<number>;
};
type UserRow = typeof users.$inferSelect;
type GroupSummary = {
  id: string;
  name: string;
};
type SpacePermissionRow = {
  id: string;
  name: string;
  permission: string;
};
type RefreshTokenClaims = RefreshTokenPayload & {
  session_id: string;
  token_use: 'refresh';
};

const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 3_600;
const REFRESH_TOKEN_EXPIRES_IN_MS = 7 * 24 * 60 * 60 * 1_000;
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_TTL_SECONDS = 15 * 60;
const SPACE_PERMISSION_RANK = new Map<string, number>([
  ['space:read', 1],
  ['space:view', 1],
  ['chat:use', 1],
  ['model:use', 1],
  ['space:edit', 2],
  ['upload:create', 2],
  ['upload:read', 2],
  ['wiki:publish', 2],
  ['wiki:rollback', 2],
  ['graphify:run', 2],
  ['graphify:view', 2],
  ['space:admin', 3],
]);
const SPACE_ROLE_BY_RANK = new Map<number, SpaceAccessRole>([
  [1, 'viewer'],
  [2, 'editor'],
  [3, 'admin'],
]);
const DUMMY_PASSWORD_FOR_TIMING_EQUALIZATION = 'timing-equalization-dummy';
let dummyPasswordHash: Promise<string> | undefined;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: AuthDatabase,
    private readonly sessionService: SessionService,
    private readonly auditService: AuditService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: AuthRedisStore,
    @Optional() @Inject(AUTH_CORE_OPTIONS) private readonly options?: AuthCoreOptions,
  ) {}

  async login(input: LoginInput, metadata: AuthRequestMetadata = {}): Promise<LoginResult> {
    const email = normalizeEmail(input.email);
    const tenantId = await this.resolveTenantId();

    if (await this.isLoginLocked(email)) {
      this.auditFailedLogin(tenantId, email, 'locked', metadata);
      throwAuthError(ErrorCode.ACCOUNT_LOCKED, 'Account is temporarily locked');
    }

    const user = await this.findUserByEmail(tenantId, email);
    let passwordMatches = false;
    if (user === undefined) {
      await verifyPassword(input.password, await getDummyPasswordHash());
    } else {
      passwordMatches = await verifyPassword(input.password, user.password_hash);
    }

    if (user === undefined || !passwordMatches) {
      await this.incrementLoginFailure(email);
      this.auditFailedLogin(tenantId, email, 'invalid_credentials', metadata);
      throwAuthError(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    if (user.status !== 'active') {
      throwAuthError(ErrorCode.ACCOUNT_DISABLED, 'Account is disabled');
    }

    await this.resetLoginFailure(email);

    const now = new Date();
    const groupsForUser = await this.getUserGroups(tenantId, user.id);
    const tokens = await this.issueTokenPair({
      tenantId,
      user,
      groupIds: groupsForUser.map((group) => group.id),
      metadata,
      now,
    });

    await this.db
      .update(users)
      .set({ last_login_at: now, updated_at: now })
      .where(and(eq(users.tenant_id, tenantId), eq(users.id, user.id)));

    this.auditService.push({
      tenant_id: tenantId,
      actor_user_id: user.id,
      action: AUDIT_EVENTS.AUTH_LOGIN,
      resource_type: 'session',
      resource_id: tokens.session.id,
      ...(metadata.ip !== undefined ? { ip: metadata.ip } : {}),
      ...(metadata.user_agent !== undefined ? { user_agent: metadata.user_agent } : {}),
      ...(metadata.request_id !== undefined ? { request_id: metadata.request_id } : {}),
    });

    return {
      access_token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expires_in: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
      user: {
        id: user.id,
        email: user.email,
        name: user.display_name,
        role: user.role,
        groups: groupsForUser.map((group) => group.id),
      },
    };
  }

  async refresh(
    refreshToken: string,
    metadata: AuthRequestMetadata = {},
  ): Promise<TokenPairResult> {
    const claims = await this.verifyRefreshToken(refreshToken);
    const tokenHash = hashRefreshToken(refreshToken);
    const session = await this.sessionService.findSessionById(claims.session_id);
    const now = new Date();

    if (session === undefined || session.refresh_token_hash !== tokenHash) {
      throwAuthError(ErrorCode.INVALID_REFRESH_TOKEN, 'Invalid refresh token');
    }

    if (session.revoked_at !== null) {
      throwAuthError(ErrorCode.TOKEN_REVOKED, 'Refresh token has been revoked');
    }

    if (session.expires_at.getTime() <= now.getTime()) {
      throwAuthError(ErrorCode.INVALID_REFRESH_TOKEN, 'Invalid refresh token');
    }

    const rotation = await this.db.transaction(async (tx) => {
      const txDb = tx as AuthDatabase;
      const [revokedSession] = await txDb
        .update(sessions)
        .set({ revoked_at: now, last_used_at: now })
        .where(
          and(
            eq(sessions.id, session.id),
            eq(sessions.refresh_token_hash, tokenHash),
            isNull(sessions.revoked_at),
            gt(sessions.expires_at, now),
          ),
        )
        .returning();

      if (revokedSession === undefined) {
        throwAuthError(ErrorCode.TOKEN_REVOKED, 'Refresh token has been revoked');
      }

      const user = await this.findUserById(revokedSession.tenant_id, revokedSession.user_id, txDb);
      if (user === undefined) {
        throwAuthError(ErrorCode.INVALID_REFRESH_TOKEN, 'Invalid refresh token');
      }

      if (user.status !== 'active') {
        throwAuthError(ErrorCode.ACCOUNT_DISABLED, 'Account is disabled');
      }

      const groupsForUser = await this.getUserGroups(revokedSession.tenant_id, user.id, txDb);
      const tokens = await this.issueTokenPair({
        tenantId: revokedSession.tenant_id,
        user,
        groupIds: groupsForUser.map((group) => group.id),
        metadata,
        now,
        db: txDb,
      });

      return { revokedSession, tokens, user };
    });

    this.auditService.push({
      tenant_id: rotation.revokedSession.tenant_id,
      actor_user_id: rotation.user.id,
      action: AUDIT_EVENTS.AUTH_TOKEN_REFRESH,
      resource_type: 'session',
      resource_id: rotation.tokens.session.id,
      metadata_json: {
        old_session_id: rotation.revokedSession.id,
      },
      ...(metadata.ip !== undefined ? { ip: metadata.ip } : {}),
      ...(metadata.user_agent !== undefined ? { user_agent: metadata.user_agent } : {}),
      ...(metadata.request_id !== undefined ? { request_id: metadata.request_id } : {}),
    });

    return {
      access_token: rotation.tokens.accessToken,
      refreshToken: rotation.tokens.refreshToken,
      expires_in: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    };
  }

  async logout(
    user: AuthenticatedRequestUser,
    input: LogoutInput = {},
    metadata: AuthRequestMetadata = {},
  ): Promise<{ success: true }> {
    const now = new Date();
    const refreshToken = input.refreshToken;

    if (refreshToken === undefined || refreshToken.trim().length === 0) {
      return { success: true };
    }

    const claims = await this.verifyRefreshToken(refreshToken);
    const session = await this.sessionService.findSessionById(claims.session_id);

    if (
      session === undefined ||
      session.tenant_id !== user.tenant_id ||
      session.user_id !== user.sub ||
      session.refresh_token_hash !== hashRefreshToken(refreshToken) ||
      session.revoked_at !== null ||
      session.expires_at.getTime() <= now.getTime()
    ) {
      throwAuthError(ErrorCode.INVALID_REFRESH_TOKEN, 'Invalid refresh token');
    }

    await this.sessionService.revokeSessionById(session.id, now, now);

    this.auditService.push({
      tenant_id: user.tenant_id,
      actor_user_id: user.sub,
      action: AUDIT_EVENTS.AUTH_LOGOUT,
      resource_type: 'session',
      resource_id: session.id,
      metadata_json: {
        scope: 'single_session',
      },
      ...(metadata.ip !== undefined ? { ip: metadata.ip } : {}),
      ...(metadata.user_agent !== undefined ? { user_agent: metadata.user_agent } : {}),
      ...(metadata.request_id !== undefined ? { request_id: metadata.request_id } : {}),
    });

    return { success: true };
  }

  async getCurrentUser(user: AuthenticatedRequestUser): Promise<CurrentUserResponse> {
    const row = await this.findUserById(user.tenant_id, user.sub);
    if (row === undefined) {
      throwAuthError(ErrorCode.UNAUTHENTICATED, 'Unauthenticated');
    }

    return {
      id: row.id,
      email: row.email,
      name: row.display_name,
      role: row.role,
      groups: await this.getUserGroups(user.tenant_id, row.id),
      spaces: await this.getUserSpaceRoles(user.tenant_id, row.id, row.role),
    };
  }

  async changePassword(
    user: AuthenticatedRequestUser,
    input: ChangePasswordInput,
    metadata: AuthRequestMetadata = {},
  ): Promise<{ success: true }> {
    const row = await this.findUserById(user.tenant_id, user.sub);
    if (row === undefined) {
      throwAuthError(ErrorCode.UNAUTHENTICATED, 'Unauthenticated');
    }

    if (!(await verifyPassword(input.current_password, row.password_hash))) {
      throw new HttpException(
        {
          code: ErrorCode.INVALID_CURRENT_PASSWORD,
          message: 'Invalid current password',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!isStrongPassword(input.new_password)) {
      throw new HttpException(
        {
          code: ErrorCode.PASSWORD_TOO_WEAK,
          message: 'Password does not meet strength requirements',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const now = new Date();
    await this.db
      .update(users)
      .set({
        password_hash: await hashPassword(input.new_password),
        updated_at: now,
      })
      .where(and(eq(users.tenant_id, user.tenant_id), eq(users.id, user.sub)));

    this.auditService.push({
      tenant_id: user.tenant_id,
      actor_user_id: user.sub,
      action: AUDIT_EVENTS.AUTH_PASSWORD_CHANGE,
      resource_type: 'user',
      resource_id: user.sub,
      ...(metadata.ip !== undefined ? { ip: metadata.ip } : {}),
      ...(metadata.user_agent !== undefined ? { user_agent: metadata.user_agent } : {}),
      ...(metadata.request_id !== undefined ? { request_id: metadata.request_id } : {}),
    });

    return { success: true };
  }

  private async issueTokenPair(input: {
    tenantId: string;
    user: UserRow;
    groupIds: string[];
    metadata: AuthRequestMetadata;
    now: Date;
    db?: AuthDatabase;
  }): Promise<{ accessToken: string; refreshToken: string; session: SessionRow }> {
    const secret = await this.resolveJwtSecret();
    const sessionId = randomUUID();
    const refreshToken = await signRefreshToken({ session_id: sessionId }, secret);
    const session = await this.sessionService.createSession(
      {
        id: sessionId,
        tenant_id: input.tenantId,
        user_id: input.user.id,
        refresh_token_hash: hashRefreshToken(refreshToken),
        expires_at: new Date(input.now.getTime() + REFRESH_TOKEN_EXPIRES_IN_MS),
        last_used_at: input.now,
        ...(input.metadata.ip !== undefined ? { ip: input.metadata.ip } : {}),
        ...(input.metadata.user_agent !== undefined
          ? { user_agent: input.metadata.user_agent }
          : {}),
      },
      input.db,
    );
    const accessToken = await signAccessToken(
      {
        sub: input.user.id,
        tenant_id: input.tenantId,
        email: input.user.email,
        role: input.user.role,
        group_ids: input.groupIds,
      },
      secret,
    );

    return { accessToken, refreshToken, session };
  }

  private async verifyRefreshToken(refreshToken: string): Promise<RefreshTokenClaims> {
    try {
      const payload = await verifyToken<RefreshTokenPayload>(
        refreshToken,
        await this.resolveJwtSecret(),
      );
      if (!isRefreshTokenClaims(payload)) {
        throw new Error('Invalid refresh token payload');
      }

      return payload;
    } catch {
      throwAuthError(ErrorCode.INVALID_REFRESH_TOKEN, 'Invalid refresh token');
    }
  }

  private async resolveJwtSecret(): Promise<string> {
    const secret = this.options?.getJwtSecret
      ? await this.options.getJwtSecret()
      : (this.options?.accessTokenSecret ?? this.options?.jwtSecret ?? process.env.JWT_SECRET);

    if (secret === undefined || secret.length === 0) {
      throw new Error('JWT_SECRET is required');
    }

    return secret;
  }

  private async resolveTenantId(): Promise<string> {
    const configuredTenantId = process.env.DEFAULT_TENANT_ID;
    if (configuredTenantId !== undefined && configuredTenantId.trim().length > 0) {
      return configuredTenantId.trim();
    }

    const [tenant] = await this.db.select({ id: tenants.id }).from(tenants).limit(1);
    if (tenant === undefined) {
      throw new Error('No tenant configured');
    }

    return tenant.id;
  }

  private async findUserByEmail(
    tenantId: string,
    email: string,
    db: AuthDatabase = this.db,
  ): Promise<UserRow | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.tenant_id, tenantId), eq(users.email, email)))
      .limit(1);

    return user;
  }

  private async findUserById(
    tenantId: string,
    userId: string,
    db: AuthDatabase = this.db,
  ): Promise<UserRow | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.tenant_id, tenantId), eq(users.id, userId)))
      .limit(1);

    return user;
  }

  private async getUserGroups(
    tenantId: string,
    userId: string,
    db: AuthDatabase = this.db,
  ): Promise<GroupSummary[]> {
    return db
      .select({
        id: groups.id,
        name: groups.name,
      })
      .from(group_members)
      .innerJoin(
        groups,
        and(eq(groups.tenant_id, group_members.tenant_id), eq(groups.id, group_members.group_id)),
      )
      .where(and(eq(group_members.tenant_id, tenantId), eq(group_members.user_id, userId)));
  }

  private async getUserSpaceRoles(
    tenantId: string,
    userId: string,
    role: string,
    db: AuthDatabase = this.db,
  ): Promise<CurrentUserResponse['spaces']> {
    if (role === 'admin' || role === 'owner') {
      const adminSpaces = await db
        .select({ id: spaces.id, name: spaces.name })
        .from(spaces)
        .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.status, 'active')));

      return adminSpaces.map((space) => ({ id: space.id, name: space.name, role: 'admin' as const }));
    }

    const rows = await db
      .select({
        id: spaces.id,
        name: spaces.name,
        permission: space_permissions.permission,
      })
      .from(group_members)
      .innerJoin(
        space_permissions,
        and(
          eq(space_permissions.tenant_id, group_members.tenant_id),
          eq(space_permissions.group_id, group_members.group_id),
        ),
      )
      .innerJoin(
        spaces,
        and(
          eq(spaces.tenant_id, space_permissions.tenant_id),
          eq(spaces.id, space_permissions.space_id),
        ),
      )
      .where(
        and(
          eq(group_members.tenant_id, tenantId),
          eq(group_members.user_id, userId),
          eq(spaces.status, 'active'),
        ),
      );

    return aggregateSpaceRoles(rows);
  }

  private async isLoginLocked(email: string): Promise<boolean> {
    const count = await this.getLoginFailureCount(email);
    return count >= LOGIN_LOCKOUT_THRESHOLD;
  }

  private async getLoginFailureCount(email: string): Promise<number> {
    if (this.redis === undefined) {
      return 0;
    }

    try {
      const value = await this.redis.get(getLoginFailureKey(email));
      const count = Number(value);
      return Number.isInteger(count) && count > 0 ? count : 0;
    } catch (err) {
      getApiLogger().warn({ err, email }, 'Login lockout counter read failed');
      return 0;
    }
  }

  private async incrementLoginFailure(email: string): Promise<number> {
    if (this.redis === undefined) {
      return 1;
    }

    try {
      const count = await this.redis.incr(getLoginFailureKey(email));
      await this.redis.expire(getLoginFailureKey(email), LOGIN_LOCKOUT_TTL_SECONDS);
      return count;
    } catch (err) {
      getApiLogger().warn({ err, email }, 'Login lockout counter increment failed');
      return 1;
    }
  }

  private async resetLoginFailure(email: string): Promise<void> {
    if (this.redis === undefined) {
      return;
    }

    try {
      await this.redis.del(getLoginFailureKey(email));
    } catch (err) {
      getApiLogger().warn({ err, email }, 'Login lockout counter reset failed');
    }
  }

  private auditFailedLogin(
    tenantId: string,
    email: string,
    reason: 'invalid_credentials' | 'locked',
    metadata: AuthRequestMetadata,
  ): void {
    this.auditService.push({
      tenant_id: tenantId,
      action: AUDIT_EVENTS.AUTH_FAILED_LOGIN,
      resource_type: 'auth',
      metadata_json: {
        email,
        reason,
      },
      ...(metadata.ip !== undefined ? { ip: metadata.ip } : {}),
      ...(metadata.user_agent !== undefined ? { user_agent: metadata.user_agent } : {}),
      ...(metadata.request_id !== undefined ? { request_id: metadata.request_id } : {}),
    });
  }
}

export function hashRefreshToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

function aggregateSpaceRoles(rows: SpacePermissionRow[]): CurrentUserResponse['spaces'] {
  const spacesById = new Map<string, { id: string; name: string; rank: number }>();

  for (const row of rows) {
    const rank = SPACE_PERMISSION_RANK.get(row.permission) ?? 0;
    if (rank === 0) {
      continue;
    }

    const existing = spacesById.get(row.id);
    if (existing === undefined || rank > existing.rank) {
      spacesById.set(row.id, { id: row.id, name: row.name, rank });
    }
  }

  return [...spacesById.values()].map((space) => ({
    id: space.id,
    name: space.name,
    role: SPACE_ROLE_BY_RANK.get(space.rank) ?? 'viewer',
  }));
}

function getLoginFailureKey(email: string): string {
  return `login_fail:${email}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

function isRefreshTokenClaims(payload: RefreshTokenPayload): payload is RefreshTokenClaims {
  return (
    payload.token_use === 'refresh' &&
    typeof payload.session_id === 'string' &&
    payload.session_id.trim().length > 0
  );
}

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword(DUMMY_PASSWORD_FOR_TIMING_EQUALIZATION);
  return dummyPasswordHash;
}

function throwAuthError(code: ErrorCode, message: string): never {
  throw new HttpException(
    {
      code,
      message,
    },
    HttpStatus.UNAUTHORIZED,
  );
}
