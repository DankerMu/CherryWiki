import { and, asc, eq, gt, isNull } from 'drizzle-orm';

import { users } from '@cherrygraph/shared';

import type {
  DrizzleDatabase,
  UserSyncJobData,
} from '../processors/user-sync.processor.js';

type DatabaseClient = Pick<DrizzleDatabase, 'select'>;

export type UserSyncQueue = {
  add: (
    name: string,
    data: UserSyncJobData,
    opts: { jobId: string },
  ) => Promise<unknown>;
  getJob: (jobId: string) => Promise<UserSyncJob | null | undefined>;
};

type UserSyncJob = {
  isFailed: () => Promise<boolean>;
  remove: () => Promise<void>;
  attemptsMade?: number;
  finishedOn?: number;
};

type UnmappedUserRow = {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
};

const USER_RECONCILE_BATCH_SIZE = 50;
const MAX_RECONCILE_RETRIES = 10;
const MIN_RETRY_AGE_MS = 5 * 60 * 1000;

export async function reconcileUsers(
  db: DrizzleDatabase,
  queue: UserSyncQueue,
): Promise<number> {
  let enqueuedCount = 0;
  let cursor: string | undefined;

  for (;;) {
    const unmappedUsers = await loadUnmappedUsers(db, cursor);
    if (unmappedUsers.length === 0) {
      return enqueuedCount;
    }

    const results = await Promise.allSettled(
      unmappedUsers.map((user) => enqueueUserSync(queue, user)),
    );
    enqueuedCount += results.filter(
      (result): result is PromiseFulfilledResult<true> =>
        result.status === 'fulfilled' && result.value,
    ).length;

    cursor = unmappedUsers[unmappedUsers.length - 1]?.userId;
  }
}

async function loadUnmappedUsers(
  db: DatabaseClient,
  afterUserId?: string,
): Promise<UnmappedUserRow[]> {
  const predicates = [
    eq(users.status, 'active'),
    isNull(users.docmost_user_id),
  ];

  if (afterUserId !== undefined) {
    predicates.push(gt(users.id, afterUserId));
  }

  return db
    .select({
      userId: users.id,
      tenantId: users.tenant_id,
      email: users.email,
      name: users.display_name,
    })
    .from(users)
    .where(and(...predicates))
    .orderBy(asc(users.id))
    .limit(USER_RECONCILE_BATCH_SIZE);
}

async function enqueueUserSync(
  queue: UserSyncQueue,
  user: UnmappedUserRow,
): Promise<boolean> {
  const jobId = `${user.tenantId}:${user.userId}`;
  const existing = await queue.getJob(jobId);

  if (existing !== null && existing !== undefined) {
    const isFailed = await existing.isFailed();
    if (!isFailed) {
      return false;
    }

    if ((existing.attemptsMade ?? 0) >= MAX_RECONCILE_RETRIES) {
      return false;
    }

    const failedAge = existing.finishedOn
      ? Date.now() - existing.finishedOn
      : Infinity;
    if (failedAge < MIN_RETRY_AGE_MS) {
      return false;
    }

    await existing.remove();
  }

  await queue.add('user.sync', user, {
    jobId,
  });
  return true;
}
