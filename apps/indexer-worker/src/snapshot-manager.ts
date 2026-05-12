import { and, eq, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { indexSnapshots, spaces } from '@cherrygraph/shared';
import type { JobDatabase } from '@cherrygraph/job-core';

export type IndexSnapshotRow = typeof indexSnapshots.$inferSelect;

const BUILDING_STATUS = 'building';
const ACTIVATED_STATUS = 'activated';
const SUPERSEDED_STATUS = 'superseded';
const FAILED_STATUS = 'failed';
const STALE_BUILDING_SNAPSHOT_MS = 2 * 60 * 60 * 1000;

export class SnapshotManager {
  static async createSnapshot(
    db: JobDatabase,
    tenantId: string,
    spaceId: string,
    embeddingModelId: string,
    graphifyRunId?: string,
    wikiRepoCommitHash = 'unknown',
  ): Promise<IndexSnapshotRow> {
    const [snapshot] = await db
      .insert(indexSnapshots)
      .values({
        id: randomUUID(),
        tenant_id: tenantId,
        space_id: spaceId,
        ...(graphifyRunId !== undefined ? { graphify_run_id: graphifyRunId } : {}),
        wiki_repo_commit_hash: wikiRepoCommitHash,
        embedding_model_id: embeddingModelId,
        chunk_count: 0,
        status: BUILDING_STATUS,
      })
      .returning();

    if (snapshot === undefined) {
      throw new Error('Failed to create index snapshot');
    }

    return snapshot;
  }

  static async activateSnapshot(db: JobDatabase, snapshotId: string, spaceId: string, chunkCount: number): Promise<void> {
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(indexSnapshots)
        .set({
          status: ACTIVATED_STATUS,
          chunk_count: chunkCount,
          activated_at: now,
        })
        .where(eq(indexSnapshots.id, snapshotId))
        .returning();

      await tx
        .update(spaces)
        .set({
          active_index_snapshot_id: snapshotId,
          updated_at: now,
        })
        .where(eq(spaces.id, spaceId))
        .returning();

      await tx
        .update(indexSnapshots)
        .set({
          status: SUPERSEDED_STATUS,
        })
        .where(
          and(
            eq(indexSnapshots.space_id, spaceId),
            eq(indexSnapshots.status, ACTIVATED_STATUS),
            ne(indexSnapshots.id, snapshotId),
          ),
        )
        .returning();
    });
  }

  static async checkBuildingExists(db: JobDatabase, tenantId: string, spaceId: string): Promise<boolean> {
    const [snapshot] = await db
      .select({ id: indexSnapshots.id, created_at: indexSnapshots.created_at })
      .from(indexSnapshots)
      .where(
        and(
          eq(indexSnapshots.tenant_id, tenantId),
          eq(indexSnapshots.space_id, spaceId),
          eq(indexSnapshots.status, BUILDING_STATUS),
        ),
      )
      .limit(1);

    if (snapshot === undefined) {
      return false;
    }

    if (Date.now() - snapshot.created_at.getTime() <= STALE_BUILDING_SNAPSHOT_MS) {
      return true;
    }

    await db
      .update(indexSnapshots)
      .set({
        status: FAILED_STATUS,
        activated_at: null,
      })
      .where(and(eq(indexSnapshots.id, snapshot.id), eq(indexSnapshots.status, BUILDING_STATUS)))
      .returning();

    console.warn('indexer-worker: recovered stale building index snapshot', {
      tenant_id: tenantId,
      space_id: spaceId,
      snapshot_id: snapshot.id,
      created_at: snapshot.created_at.toISOString(),
    });

    return false;
  }

  static async markSnapshotFailed(db: JobDatabase, snapshotId: string): Promise<void> {
    await db
      .update(indexSnapshots)
      .set({
        status: FAILED_STATUS,
        activated_at: null,
      })
      .where(eq(indexSnapshots.id, snapshotId))
      .returning();
  }
}
