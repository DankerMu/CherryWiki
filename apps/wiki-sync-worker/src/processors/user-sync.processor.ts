import type { Job } from 'bullmq';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { group_members, space_permissions, spaces, users } from '@cherrygraph/shared';

export const BRIDGE_USER_SYNC_QUEUE = 'bridge-user-sync';

export type DrizzleDatabase = NodePgDatabase;
type DatabaseClient = Pick<DrizzleDatabase, 'select' | 'update'>;

export interface UserSyncDeps {
  db: DatabaseClient;
  bridgeClient: UserSyncBridgeClient;
  permissionSyncQueue?: PermissionSyncQueue;
}

export interface UserSyncBridgeClient {
  syncUser(input: {
    email: string;
    name: string;
    cherry_user_id: string;
  }): Promise<{ docmost_user_id: string }>;
}

export type UserSyncJobData = {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
};

export type PermissionSyncQueue = {
  add(
    name: string,
    data: { spaceId: string; tenantId: string },
    opts?: { jobId?: string },
  ): Promise<unknown>;
};

type AffectedSpaceRow = {
  spaceId: string;
  tenantId: string;
};

export function createUserSyncProcessor(
  deps: UserSyncDeps,
): (job: Job<UserSyncJobData>) => Promise<void> {
  return async (job) => {
    const data = readJobData(job.data);
    const result = await deps.bridgeClient.syncUser({
      email: data.email,
      name: data.name,
      cherry_user_id: data.userId,
    });

    await writeBackDocmostUserId(deps.db, data, result.docmost_user_id);
    await enqueueAffectedPermissionSyncJobs(deps.db, deps.permissionSyncQueue, data);

    console.info('user-sync: user synced to Docmost', {
      userId: data.userId,
      tenantId: data.tenantId,
      docmostUserId: result.docmost_user_id,
    });
  };
}

async function writeBackDocmostUserId(
  db: DatabaseClient,
  data: UserSyncJobData,
  docmostUserId: string,
): Promise<void> {
  const updated = await db
    .update(users)
    .set({ docmost_user_id: docmostUserId, updated_at: new Date() })
    .where(
      and(
        eq(users.id, data.userId),
        eq(users.tenant_id, data.tenantId),
        isNull(users.docmost_user_id),
      ),
    )
    .returning({ id: users.id });

  if (updated.length === 0) {
    console.info('user-sync: skipped docmost_user_id writeback; mapping already exists', {
      userId: data.userId,
      tenantId: data.tenantId,
      docmostUserId,
    });
  }
}

async function enqueueAffectedPermissionSyncJobs(
  db: DatabaseClient,
  queue: PermissionSyncQueue | undefined,
  data: UserSyncJobData,
): Promise<void> {
  if (queue === undefined) {
    return;
  }

  const rows = await loadAffectedSyncedSpaces(db, data);
  const uniqueSpaces = new Map<string, AffectedSpaceRow>();
  for (const row of rows) {
    uniqueSpaces.set(`${row.tenantId}:${row.spaceId}`, row);
  }

  await Promise.all(
    [...uniqueSpaces.values()].map((space) =>
      queue.add('permission.sync', {
        spaceId: space.spaceId,
        tenantId: space.tenantId,
      }),
    ),
  );
}

async function loadAffectedSyncedSpaces(
  db: DatabaseClient,
  data: UserSyncJobData,
): Promise<AffectedSpaceRow[]> {
  return db
    .select({
      spaceId: spaces.id,
      tenantId: spaces.tenant_id,
    })
    .from(space_permissions)
    .innerJoin(
      group_members,
      and(
        eq(space_permissions.tenant_id, group_members.tenant_id),
        eq(space_permissions.group_id, group_members.group_id),
      ),
    )
    .innerJoin(
      spaces,
      and(
        eq(space_permissions.tenant_id, spaces.tenant_id),
        eq(space_permissions.space_id, spaces.id),
      ),
    )
    .where(
      and(
        eq(group_members.user_id, data.userId),
        eq(group_members.tenant_id, data.tenantId),
        isNotNull(spaces.docmost_space_id),
      ),
    );
}

function readJobData(data: unknown): UserSyncJobData {
  const record = readRecord(data);
  const userId = readString(record.userId);
  const email = readString(record.email);
  const name = readString(record.name);
  const tenantId = readString(record.tenantId);

  if (
    userId === undefined ||
    email === undefined ||
    name === undefined ||
    tenantId === undefined
  ) {
    throw new Error('user-sync job is missing userId, email, name, or tenantId');
  }

  return { userId, email, name, tenantId };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
