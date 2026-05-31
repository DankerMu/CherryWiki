import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ROLE_PERMISSIONS, ROLES, normalizeRole } from '@cherrygraph/auth-core';
import {
  ErrorCode,
  chatSessionSpaces,
  chatSessions,
  group_members,
  space_permissions,
  spaces,
} from '@cherrygraph/shared';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';

import {
  buildPaginationMeta,
  paginatedResponse,
  type PaginatedResponse,
} from '../common/dto/pagination.dto.js';
import { throwApiError } from '../common/errors/api-error.js';
import { DRIZZLE } from '../database/drizzle.constants.js';

type ChatDatabase = NodePgDatabase;
export type ChatSessionRow = typeof chatSessions.$inferSelect;
export type SpaceRow = typeof spaces.$inferSelect;

export type SpaceDisplayInfo = {
  id: string;
  name: string;
};

export type ChatSessionResponse = {
  id: string;
  tenant_id: string;
  space_id: string;
  space_ids: string[];
  space_details: SpaceDisplayInfo[];
  user_id: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
};

export type SpacePermissionCheckInput = {
  tenantId: string;
  userId: string;
  userGroupIds: string[];
  actorRole?: string;
  actorPermissions?: string[];
  spacePermissions?: Record<string, string[]>;
};

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class ChatSessionBoundaryService {
  constructor(@Inject(DRIZZLE) private readonly db: ChatDatabase) {}

  async createSession(
    tenantId: string,
    spaceId: string,
    userId: string,
    spaceIds: string[] = [spaceId],
  ): Promise<string> {
    const now = new Date();
    const normalizedSpaceIds = uniqueNonEmptyStrings(spaceIds.length > 0 ? spaceIds : [spaceId]);

    const sessionId = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(chatSessions)
        .values({
          id: randomUUID(),
          tenant_id: tenantId,
          space_id: spaceId,
          user_id: userId,
          title: null,
          created_at: now,
          updated_at: now,
        })
        .returning();

      if (created === undefined) {
        throw new Error('Failed to create chat session');
      }

      await tx.insert(chatSessionSpaces).values(
        normalizedSpaceIds.map((selectedSpaceId, position) => ({
          session_id: created.id,
          tenant_id: tenantId,
          space_id: selectedSpaceId,
          position,
          created_at: now,
        })),
      );

      return created.id;
    });

    return sessionId;
  }

  async updateSessionSpaces(
    tenantId: string,
    sessionId: string,
    userId: string,
    primarySpaceId: string,
    requestedSpaceIds: string[],
    spacePermissions?: Record<string, string[]>,
    userGroupIds: string[] = [],
    actorRole?: string,
  ): Promise<{ session_id: string; space_ids: string[]; space_details: SpaceDisplayInfo[] }> {
    const normalizedSpaceIds = this.normalizeSpaceScope({
      space_id: primarySpaceId,
      space_ids: requestedSpaceIds,
    });
    const { session } = await this.requireSession(tenantId, sessionId, userId, primarySpaceId);
    const spacesForScope = await this.requireSpaces(tenantId, normalizedSpaceIds);
    await this.assertChatUseOnSpaces(
      {
        tenantId,
        userId,
        userGroupIds,
        ...(actorRole !== undefined ? { actorRole } : {}),
        ...(spacePermissions !== undefined ? { spacePermissions } : {}),
      },
      normalizedSpaceIds,
    );

    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .delete(chatSessionSpaces)
        .where(and(eq(chatSessionSpaces.tenant_id, tenantId), eq(chatSessionSpaces.session_id, sessionId)));

      await tx.insert(chatSessionSpaces).values(
        normalizedSpaceIds.map((spaceId, position) => ({
          session_id: sessionId,
          tenant_id: tenantId,
          space_id: spaceId,
          position,
          created_at: now,
        })),
      );

      await tx
        .update(chatSessions)
        .set({ updated_at: now })
        .where(and(eq(chatSessions.tenant_id, tenantId), eq(chatSessions.id, sessionId)));
    });

    const spaceById = new Map(spacesForScope.map((space) => [space.id, space]));
    return {
      session_id: session.id,
      space_ids: normalizedSpaceIds,
      space_details: normalizedSpaceIds.map((spaceId) => ({
        id: spaceId,
        name: spaceById.get(spaceId)?.name ?? spaceId,
      })),
    };
  }

  async listSessions(
    tenantId: string,
    spaceId: string,
    userId: string,
    pageInput?: number,
    limitInput?: number,
  ): Promise<PaginatedResponse<ChatSessionResponse>> {
    await this.requireSpace(tenantId, spaceId);
    const page = normalizePositiveInt(pageInput, DEFAULT_PAGE);
    const limit = normalizePositiveInt(limitInput, DEFAULT_LIMIT, MAX_LIMIT);
    const where = and(
      eq(chatSessions.tenant_id, tenantId),
      eq(chatSessions.user_id, userId),
      eq(chatSessionSpaces.tenant_id, tenantId),
      eq(chatSessionSpaces.space_id, spaceId),
    );

    const rows = await this.db
      .select({
        id: chatSessions.id,
        tenant_id: chatSessions.tenant_id,
        space_id: chatSessions.space_id,
        user_id: chatSessions.user_id,
        title: chatSessions.title,
        created_at: chatSessions.created_at,
        updated_at: chatSessions.updated_at,
      })
      .from(chatSessions)
      .innerJoin(chatSessionSpaces, eq(chatSessionSpaces.session_id, chatSessions.id))
      .where(where)
      .orderBy(desc(chatSessions.updated_at))
      .limit(limit)
      .offset((page - 1) * limit);
    const [countRow] = await this.db
      .select({ total: count() })
      .from(chatSessions)
      .innerJoin(chatSessionSpaces, eq(chatSessionSpaces.session_id, chatSessions.id))
      .where(where);
    const spaceInfoBySession = await this.loadSpaceInfoForSessions(rows);

    return paginatedResponse(
      rows.map((row) => {
        const spaceInfo = spaceInfoBySession.get(row.id);
        return toChatSessionResponse(row, spaceInfo?.spaceIds, spaceInfo?.spaceDetails);
      }),
      buildPaginationMeta(page, limit, normalizeCount(countRow?.total)),
    );
  }

  async resolveSession(input: {
    tenantId: string;
    spaceId: string;
    userId: string;
    sessionId: string | undefined;
    requestedSpaceIds: string[];
    explicitScope: boolean;
  }): Promise<{ session: ChatSessionRow; spaceIds: string[] }> {
    if (input.sessionId === undefined || input.sessionId.trim().length === 0) {
      const createdSessionId = await this.createSession(
        input.tenantId,
        input.spaceId,
        input.userId,
        input.requestedSpaceIds,
      );
      const session = await this.findSessionById(input.tenantId, createdSessionId);
      if (session === undefined) {
        throw new Error('Created chat session could not be loaded');
      }

      return { session, spaceIds: input.requestedSpaceIds };
    }

    const result = await this.requireSession(input.tenantId, input.sessionId, input.userId, input.spaceId);
    if (input.explicitScope && !sameStringArray(result.spaceIds, input.requestedSpaceIds)) {
      return { session: result.session, spaceIds: result.spaceIds };
    }

    return result;
  }

  async requireSession(
    tenantId: string,
    sessionId: string,
    userId: string,
    spaceId: string | undefined,
  ): Promise<{ session: ChatSessionRow; spaceIds: string[]; spaceDetails: SpaceDisplayInfo[] }> {
    const session = await this.findSessionById(tenantId, sessionId);
    if (session === undefined) {
      throwApiError(ErrorCode.SESSION_NOT_FOUND, 'Chat session was not found', HttpStatus.NOT_FOUND);
    }

    if (session.user_id !== userId) {
      throwApiError(ErrorCode.PERMISSION_DENIED, 'Cannot access another user chat session', HttpStatus.FORBIDDEN);
    }

    const { spaceIds, spaceDetails } = await this.loadSessionSpaceInfo(session);
    if (spaceId !== undefined && !spaceIds.includes(spaceId)) {
      throwApiError(ErrorCode.SESSION_NOT_FOUND, 'Chat session was not found', HttpStatus.NOT_FOUND);
    }

    return { session, spaceIds, spaceDetails };
  }

  async findSessionById(tenantId: string, sessionId: string): Promise<ChatSessionRow | undefined> {
    const [session] = await this.db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.tenant_id, tenantId), eq(chatSessions.id, sessionId)))
      .limit(1);

    return session;
  }

  async loadSessionSpaceInfo(
    session: ChatSessionRow,
  ): Promise<{ spaceIds: string[]; spaceDetails: SpaceDisplayInfo[] }> {
    const rows = await this.db
      .select({ space_id: chatSessionSpaces.space_id, space_name: spaces.name })
      .from(chatSessionSpaces)
      .innerJoin(
        spaces,
        and(eq(spaces.tenant_id, chatSessionSpaces.tenant_id), eq(spaces.id, chatSessionSpaces.space_id)),
      )
      .where(and(eq(chatSessionSpaces.tenant_id, session.tenant_id), eq(chatSessionSpaces.session_id, session.id)))
      .orderBy(asc(chatSessionSpaces.position));

    if (rows.length === 0) {
      return {
        spaceIds: [session.space_id],
        spaceDetails: [{ id: session.space_id, name: session.space_id }],
      };
    }

    return {
      spaceIds: rows.map((row) => row.space_id),
      spaceDetails: rows.map((row) => ({
        id: row.space_id,
        name: typeof row.space_name === 'string' ? row.space_name : row.space_id,
      })),
    };
  }

  async loadSpaceInfoForSessions(
    sessions: ChatSessionRow[],
  ): Promise<Map<string, { spaceIds: string[]; spaceDetails: SpaceDisplayInfo[] }>> {
    const bySession = new Map<string, { spaceIds: string[]; spaceDetails: SpaceDisplayInfo[] }>();
    if (sessions.length === 0) {
      return bySession;
    }

    const sessionIds = sessions.map((session) => session.id);
    const rows = await this.db
      .select({
        session_id: chatSessionSpaces.session_id,
        space_id: chatSessionSpaces.space_id,
        space_name: spaces.name,
      })
      .from(chatSessionSpaces)
      .innerJoin(
        spaces,
        and(eq(spaces.tenant_id, chatSessionSpaces.tenant_id), eq(spaces.id, chatSessionSpaces.space_id)),
      )
      .where(inArray(chatSessionSpaces.session_id, sessionIds))
      .orderBy(asc(chatSessionSpaces.session_id), asc(chatSessionSpaces.position));

    for (const row of rows) {
      const sessionInfo = bySession.get(row.session_id) ?? { spaceIds: [], spaceDetails: [] };
      sessionInfo.spaceIds.push(row.space_id);
      sessionInfo.spaceDetails.push({
        id: row.space_id,
        name: typeof row.space_name === 'string' ? row.space_name : row.space_id,
      });
      bySession.set(row.session_id, sessionInfo);
    }

    for (const session of sessions) {
      if (!bySession.has(session.id)) {
        bySession.set(session.id, {
          spaceIds: [session.space_id],
          spaceDetails: [{ id: session.space_id, name: session.space_id }],
        });
      }
    }

    return bySession;
  }

  async requireSpace(tenantId: string, spaceId: string): Promise<SpaceRow> {
    const [space] = await this.db
      .select()
      .from(spaces)
      .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.id, spaceId), eq(spaces.status, 'active')))
      .limit(1);

    if (space === undefined) {
      throwApiError(ErrorCode.SPACE_NOT_FOUND, 'Space not found', HttpStatus.NOT_FOUND);
    }

    return space;
  }

  async requireSpaces(tenantId: string, spaceIds: string[]): Promise<SpaceRow[]> {
    const resolved: SpaceRow[] = [];
    for (const spaceId of spaceIds) {
      resolved.push(await this.requireSpace(tenantId, spaceId));
    }

    return resolved;
  }

  normalizeSpaceScope(dto: { space_id?: string; space_ids?: string[] }): string[] {
    const primarySpaceId = normalizeSpaceId(dto.space_id);
    const providedSpaceIds = dto.space_ids;

    if (providedSpaceIds !== undefined && providedSpaceIds.length > 10) {
      throwApiError(ErrorCode.VALIDATION_ERROR, 'At most 10 Spaces can be selected', HttpStatus.BAD_REQUEST);
    }

    if (providedSpaceIds !== undefined && providedSpaceIds.length === 0) {
      throwApiError(ErrorCode.VALIDATION_ERROR, 'space_ids must not be empty when provided', HttpStatus.BAD_REQUEST);
    }

    if (providedSpaceIds !== undefined && providedSpaceIds.length > 0) {
      const normalized = uniqueNonEmptyStrings(providedSpaceIds);
      if (
        normalized.length !== providedSpaceIds.length &&
        providedSpaceIds.some((spaceId) => normalizeSpaceId(spaceId) === undefined)
      ) {
        throwApiError(ErrorCode.VALIDATION_ERROR, 'Space IDs must be non-empty strings', HttpStatus.BAD_REQUEST);
      }
      if (normalized.length === 0) {
        throwApiError(ErrorCode.VALIDATION_ERROR, 'At least one Space is required', HttpStatus.BAD_REQUEST);
      }
      if (primarySpaceId !== undefined && !normalized.includes(primarySpaceId)) {
        throwApiError(ErrorCode.VALIDATION_ERROR, 'space_id must be included in space_ids', HttpStatus.BAD_REQUEST);
      }
      if (normalized.length > 10) {
        throwApiError(ErrorCode.VALIDATION_ERROR, 'At most 10 Spaces can be selected', HttpStatus.BAD_REQUEST);
      }

      return normalized;
    }

    if (primarySpaceId !== undefined) {
      return [primarySpaceId];
    }

    throwApiError(ErrorCode.VALIDATION_ERROR, 'At least one Space is required', HttpStatus.BAD_REQUEST);
  }

  async assertChatUseOnSpaces(input: SpacePermissionCheckInput, spaceIds: string[]): Promise<void> {
    if (
      input.actorRole === undefined &&
      input.actorPermissions === undefined &&
      input.spacePermissions === undefined
    ) {
      return;
    }

    const role = input.actorRole === undefined ? undefined : normalizeRole(input.actorRole);
    if (role === ROLES.OWNER || role === ROLES.ADMIN) {
      return;
    }

    const rolePermissions = role === undefined ? [] : [...ROLE_PERMISSIONS[role]];
    if (!rolePermissions.includes('chat:use')) {
      throwApiError(ErrorCode.PERMISSION_DENIED, 'Permission denied', HttpStatus.FORBIDDEN);
    }

    const missingSpaceIds: string[] = [];
    for (const spaceId of spaceIds) {
      const directPermissions = input.spacePermissions?.[spaceId];
      if (directPermissions !== undefined) {
        if (!permissionSetSatisfiesChatUse(directPermissions)) {
          throwApiError(ErrorCode.PERMISSION_DENIED, 'Permission denied', HttpStatus.FORBIDDEN);
        }
        continue;
      }

      missingSpaceIds.push(spaceId);
    }

    if (missingSpaceIds.length === 0 || input.actorRole === undefined) {
      return;
    }

    if (input.userGroupIds.length === 0) {
      throwApiError(ErrorCode.PERMISSION_DENIED, 'Permission denied', HttpStatus.FORBIDDEN);
    }

    const rows = await this.db
      .select({
        space_id: space_permissions.space_id,
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
      .where(
        and(
          eq(group_members.tenant_id, input.tenantId),
          eq(group_members.user_id, input.userId),
          inArray(group_members.group_id, input.userGroupIds),
          inArray(space_permissions.space_id, missingSpaceIds),
          inArray(space_permissions.permission, ['chat:use', 'space:admin']),
        ),
      );
    const allowed = new Set(rows.map((row) => row.space_id));

    if (missingSpaceIds.some((spaceId) => !allowed.has(spaceId))) {
      throwApiError(ErrorCode.PERMISSION_DENIED, 'Permission denied', HttpStatus.FORBIDDEN);
    }
  }

  async deleteSessionRecord(sessionId: string): Promise<void> {
    await this.db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
  }
}

export function toChatSessionResponse(
  row: ChatSessionRow,
  spaceIds?: string[],
  spaceDetails?: SpaceDisplayInfo[],
): ChatSessionResponse {
  const ids = spaceIds ?? [row.space_id];
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    space_id: row.space_id,
    space_ids: ids,
    space_details: spaceDetails ?? ids.map((id) => ({ id, name: id })),
    user_id: row.user_id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeSpaceId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeSpaceId(value);
    if (normalized === undefined || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function permissionSetSatisfiesChatUse(permissions: readonly string[]): boolean {
  return permissions.includes('chat:use') || permissions.includes('space:admin');
}

function normalizePositiveInt(value: number | undefined, fallback: number, max?: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  const normalized = Math.trunc(value);
  return max === undefined ? normalized : Math.min(normalized, max);
}

function normalizeCount(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
