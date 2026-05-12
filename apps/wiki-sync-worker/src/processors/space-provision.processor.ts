import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { spaces } from '@cherrygraph/shared';

export const BRIDGE_SPACE_PROVISION_QUEUE = 'bridge-space-provision';

export type DrizzleDatabase = NodePgDatabase;
type DatabaseClient = Pick<DrizzleDatabase, 'update'>;

export interface SpaceProvisionDeps {
  db: DrizzleDatabase;
  bridgeClient: SpaceProvisionBridgeClient;
}

export interface SpaceProvisionBridgeClient {
  provisionSpace(input: {
    name: string;
    slug: string;
    cherry_space_id: string;
  }): Promise<{ docmost_space_id: string }>;
}

export type SpaceProvisionJobData = {
  spaceId: string;
  tenantId: string;
  spaceName: string;
  spaceSlug: string;
};

export function createSpaceProvisionProcessor(
  deps: SpaceProvisionDeps,
): (job: Job<SpaceProvisionJobData>) => Promise<void> {
  return async (job) => {
    const data = readJobData(job.data);
    const result = await deps.bridgeClient.provisionSpace({
      name: data.spaceName,
      slug: data.spaceSlug,
      cherry_space_id: data.spaceId,
    });

    await writeBackDocmostSpaceId(deps.db, data, result.docmost_space_id);
  };
}

async function writeBackDocmostSpaceId(
  db: DatabaseClient,
  data: SpaceProvisionJobData,
  docmostSpaceId: string,
): Promise<void> {
  await db
    .update(spaces)
    .set({ docmost_space_id: docmostSpaceId, updated_at: new Date() })
    .where(and(eq(spaces.id, data.spaceId), eq(spaces.tenant_id, data.tenantId)));
}

function readJobData(data: unknown): SpaceProvisionJobData {
  const record = readRecord(data);
  const spaceId = readString(record.spaceId);
  const tenantId = readString(record.tenantId);
  const spaceName = readString(record.spaceName);
  const spaceSlug = readString(record.spaceSlug);

  if (
    spaceId === undefined ||
    tenantId === undefined ||
    spaceName === undefined ||
    spaceSlug === undefined
  ) {
    throw new Error('space-provision job is missing spaceId, tenantId, spaceName, or spaceSlug');
  }

  return { spaceId, tenantId, spaceName, spaceSlug };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
