import type { Job } from 'bullmq';

export const BRIDGE_USER_SYNC_QUEUE = 'bridge-user-sync';

export interface UserSyncDeps {
  bridgeClient: UserSyncBridgeClient;
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

    console.info('user-sync: user synced to Docmost', {
      userId: data.userId,
      tenantId: data.tenantId,
      docmostUserId: result.docmost_user_id,
    });
  };
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
