import type { Job as BullMQJob } from 'bullmq';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import type { EmbeddingProvider } from '@cherrygraph/ai-core';
import type { RedisJobLockClient, JobDatabase, JobRow } from '@cherrygraph/job-core';
import {
  embeddings,
  graphEdges,
  graphEvidenceRefs,
  indexSnapshots,
  model_configs,
  sourceLinks,
  space_permissions,
  spaces,
  wikiChunks,
  wikiPageVersions,
  wikiPages,
  wikiSections,
} from '@cherrygraph/shared';
import {
  buildAclJson,
  chunkPage,
  computeSourceChain,
  type AclJson,
  type SourceChainJson,
} from '@cherrygraph/rag-core';
import { AbstractBullMQWorker } from '@cherrygraph/job-core';

import { indexerPayloadSchema, type IndexerPayload } from './indexer-payload.js';
import { SnapshotManager, type IndexSnapshotRow } from './snapshot-manager.js';

type IndexerBullMQPayload = { jobId: string };

type IndexerResult = {
  snapshot_id: string;
  chunk_count: number;
};

type ModelConfigRow = Pick<
  typeof model_configs.$inferSelect,
  'id' | 'provider' | 'model_id' | 'base_url' | 'encrypted_api_key_ref' | 'embedding_dim'
>;

type PublishedPageRow = {
  page: typeof wikiPages.$inferSelect;
  version: typeof wikiPageVersions.$inferSelect;
};

type PreviousChunkRow = {
  chunk: typeof wikiChunks.$inferSelect;
  embedding: typeof embeddings.$inferSelect | null;
};

type SpaceConfigInput = {
  graphify_config?: {
    classification?: string | null;
  } | null;
};

type ChunkInsert = typeof wikiChunks.$inferInsert;
type EmbeddingInsert = typeof embeddings.$inferInsert;

type ChunkPlan = {
  chunk: ChunkInsert & { id: string; content: string };
  reusedEmbedding?: number[];
  copiedFromChunkId?: string;
};

const EMBEDDING_BATCH_SIZE = 128;
const INDEX_STATUS_PENDING = 'pending';
const INDEX_STATUS_INDEXED = 'indexed';

export class IndexingInProgressError extends Error {
  readonly code = 'INDEXING_IN_PROGRESS';
  readonly retryable = false;

  constructor(spaceId: string) {
    super(`Indexing is already in progress for space ${spaceId}`);
    this.name = 'IndexingInProgressError';
  }
}

export class IndexerWorker extends AbstractBullMQWorker<IndexerBullMQPayload, IndexerResult> {
  constructor(
    db: JobDatabase,
    redis: RedisJobLockClient,
    private readonly embeddingProvider: EmbeddingProvider,
    workerId: string,
  ) {
    super(db, redis, workerId);
  }

  protected async process(job: JobRow, bullJob: BullMQJob<IndexerBullMQPayload, IndexerResult, string>): Promise<IndexerResult> {
    void bullJob;

    let snapshotId: string | undefined;
    let activationCommitted = false;

    try {
      const payload = indexerPayloadSchema.parse(job.payload_json);
      await this.recordProgress(job.id, {
        stage: 'indexing_started',
        tenant_id: payload.tenant_id,
        space_id: payload.space_id,
        scope: payload.scope,
      });

      if (await this.checkBuildingExists(payload.tenant_id, payload.space_id)) {
        throw new IndexingInProgressError(payload.space_id);
      }

      const embeddingModel = await this.resolveEmbeddingModel(payload.tenant_id);
      const pages = await this.loadPublishedPages(payload);
      const targetPage = this.resolveTargetPage(payload, pages);
      const wikiRepoCommitHash = resolveWikiRepoCommitHash(pages);
      const activeSnapshot = await this.loadActiveSnapshot(payload.space_id);
      const previousChunks =
        activeSnapshot === undefined ? [] : await this.loadSnapshotChunks(payload.space_id, activeSnapshot.id);
      const previousByPosition = buildPreviousChunkMap(previousChunks, embeddingModel.id);

      // graphify 完成的 reindex 会带 graphify_run_id；手动重建不带，
      // 此时继承当前激活快照的 run（自愈：若激活快照也为空，回退到该 space 最近一个有 run 的快照），
      // 否则新快照 graphify_run_id 为空会令 Graph Explorer 丢失图谱可见性。
      const graphifyRunId =
        payload.graphify_run_id ??
        activeSnapshot?.graphify_run_id ??
        (await this.loadLatestGraphifyRunId(payload.tenant_id, payload.space_id));
      const snapshot = await this.createSnapshot(
        payload,
        embeddingModel.id,
        wikiRepoCommitHash,
        graphifyRunId ?? undefined,
      );
      snapshotId = snapshot.id;

      const chunkPlans =
        payload.scope === 'single_page'
          ? await this.planSinglePageSnapshot(payload, snapshot.id, embeddingModel.id, targetPage, previousChunks, previousByPosition)
          : await this.planRebuiltSnapshot(snapshot.id, embeddingModel.id, pages, previousByPosition);

      await this.insertChunks(chunkPlans.map((plan) => plan.chunk));
      await this.recordProgress(job.id, {
        stage: 'chunks_created',
        count: chunkPlans.length,
        snapshot_id: snapshot.id,
      });

      await this.embedAndInsert(chunkPlans, embeddingModel.id, job.id);
      await this.markChunksIndexed(
        chunkPlans.map((plan) => plan.chunk.id),
        new Date(),
      );

      await this.activateSnapshot(snapshot.id, payload.space_id, chunkPlans.length);
      activationCommitted = true;
      await this.recordProgress(job.id, {
        stage: 'snapshot_activated',
        snapshot_id: snapshot.id,
      });

      return {
        snapshot_id: snapshot.id,
        chunk_count: chunkPlans.length,
      };
    } catch (error) {
      await this.recordFailureProgress(job.id, error);

      if (snapshotId !== undefined && !activationCommitted) {
        await this.markSnapshotFailed(snapshotId);
      }

      throw error;
    }
  }

  protected checkBuildingExists(tenantId: string, spaceId: string): Promise<boolean> {
    return SnapshotManager.checkBuildingExists(this.db, tenantId, spaceId);
  }

  protected async resolveEmbeddingModel(tenantId: string): Promise<ModelConfigRow> {
    const [modelConfig] = await this.db
      .select({
        id: model_configs.id,
        provider: model_configs.provider,
        model_id: model_configs.model_id,
        base_url: model_configs.base_url,
        encrypted_api_key_ref: model_configs.encrypted_api_key_ref,
        embedding_dim: model_configs.embedding_dim,
      })
      .from(model_configs)
      .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.model_type, 'embedding'), eq(model_configs.enabled, true)))
      .orderBy(asc(model_configs.created_at))
      .limit(1);

    if (modelConfig === undefined) {
      throw new Error(`No enabled embedding model configured for tenant ${tenantId}`);
    }

    return modelConfig;
  }

  protected createSnapshot(
    payload: IndexerPayload,
    embeddingModelId: string,
    wikiRepoCommitHash: string,
    graphifyRunId: string | undefined,
  ): Promise<IndexSnapshotRow> {
    return SnapshotManager.createSnapshot(
      this.db,
      payload.tenant_id,
      payload.space_id,
      embeddingModelId,
      graphifyRunId,
      wikiRepoCommitHash,
    );
  }

  protected async loadLatestGraphifyRunId(tenantId: string, spaceId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ graphify_run_id: indexSnapshots.graphify_run_id })
      .from(indexSnapshots)
      .where(
        and(
          eq(indexSnapshots.tenant_id, tenantId),
          eq(indexSnapshots.space_id, spaceId),
          isNotNull(indexSnapshots.graphify_run_id),
          // Only snapshots that were actually live can be trusted; 'building'/'ready'/'failed'
          // graph imports may be incomplete or rolled back.
          inArray(indexSnapshots.status, ['activated', 'superseded']),
        ),
      )
      .orderBy(desc(indexSnapshots.created_at), desc(indexSnapshots.id))
      .limit(1);

    return row?.graphify_run_id ?? undefined;
  }

  protected async loadActiveSnapshot(spaceId: string): Promise<IndexSnapshotRow | undefined> {
    const [space] = await this.db
      .select({
        active_index_snapshot_id: spaces.active_index_snapshot_id,
      })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .limit(1);

    if (space?.active_index_snapshot_id === null || space?.active_index_snapshot_id === undefined) {
      return undefined;
    }

    const [snapshot] = await this.db
      .select()
      .from(indexSnapshots)
      .where(eq(indexSnapshots.id, space.active_index_snapshot_id))
      .limit(1);

    return snapshot;
  }

  protected async loadPublishedPages(payload: IndexerPayload): Promise<PublishedPageRow[]> {
    const rows = await this.db
      .select({
        page: wikiPages,
        version: wikiPageVersions,
      })
      .from(wikiPages)
      .innerJoin(wikiPageVersions, eq(wikiPages.current_version_id, wikiPageVersions.id))
      .where(
        and(
          eq(wikiPages.tenant_id, payload.tenant_id),
          eq(wikiPages.space_id, payload.space_id),
          eq(wikiPageVersions.status, 'published'),
        ),
      )
      .orderBy(asc(wikiPages.page_id));

    if (payload.scope !== 'single_page') {
      return rows;
    }

    return rows.filter((row) => row.page.page_id === payload.page_id);
  }

  protected async loadSections(pageVersionId: string): Promise<Array<typeof wikiSections.$inferSelect>> {
    return this.db
      .select()
      .from(wikiSections)
      .where(eq(wikiSections.page_version_id, pageVersionId))
      .orderBy(asc(wikiSections.section_index));
  }

  protected async loadSnapshotChunks(spaceId: string, snapshotId: string): Promise<PreviousChunkRow[]> {
    return this.db
      .select({
        chunk: wikiChunks,
        embedding: embeddings,
      })
      .from(wikiChunks)
      .leftJoin(embeddings, eq(embeddings.chunk_id, wikiChunks.id))
      .where(and(eq(wikiChunks.space_id, spaceId), eq(wikiChunks.index_snapshot_id, snapshotId)))
      .orderBy(asc(wikiChunks.page_version_id), asc(wikiChunks.chunk_index));
  }

  protected async computeSourceChain(page: PublishedPageRow): Promise<SourceChainJson> {
    return computeSourceChain(page.page.id, page.version.id, {
      getSourceLinks: (pageVersionId) =>
        this.db
          .select({
            source_document_id: sourceLinks.source_document_id,
          })
          .from(sourceLinks)
          .where(eq(sourceLinks.page_version_id, pageVersionId)),
      getGraphEvidenceRefs: (pageId, pageVersionId) =>
        this.db
          .select({
            edge_id: graphEvidenceRefs.edge_id,
            source_document_id: graphEvidenceRefs.source_document_id,
            confidence_contribution: graphEvidenceRefs.confidence_contribution,
            source_node_id: graphEdges.source_node_id,
            target_node_id: graphEdges.target_node_id,
            confidence_label: graphEdges.confidence_label,
            effective_confidence_score: graphEdges.effective_confidence_score,
          })
          .from(graphEvidenceRefs)
          .leftJoin(graphEdges, eq(graphEdges.id, graphEvidenceRefs.edge_id))
          .where(and(eq(graphEvidenceRefs.page_id, pageId), eq(graphEvidenceRefs.page_version_id, pageVersionId))),
    });
  }

  protected async buildAcl(page: PublishedPageRow): Promise<AclJson> {
    const [space] = await this.db
      .select({
        graphify_config: spaces.graphify_config,
      })
      .from(spaces)
      .where(eq(spaces.id, page.page.space_id))
      .limit(1);

    return buildAclJson(page.page, page.version, normalizeSpaceConfig(space), {
      getAllowedGroupIds: async (spaceId) => {
        const rows = await this.db
          .select({
            group_id: space_permissions.group_id,
          })
          .from(space_permissions)
          .where(eq(space_permissions.space_id, spaceId));

        return [...new Set(rows.map((row) => row.group_id))];
      },
    });
  }

  protected insertChunks(chunks: ChunkInsert[]): Promise<unknown> {
    if (chunks.length === 0) {
      return Promise.resolve();
    }

    return this.db.insert(wikiChunks).values(chunks).returning();
  }

  protected insertEmbeddings(rows: EmbeddingInsert[]): Promise<unknown> {
    if (rows.length === 0) {
      return Promise.resolve();
    }

    return this.db.insert(embeddings).values(rows).returning();
  }

  protected markChunksIndexed(chunkIds: string[], indexedAt: Date): Promise<unknown> {
    if (chunkIds.length === 0) {
      return Promise.resolve();
    }

    return this.db
      .update(wikiChunks)
      .set({
        index_status: INDEX_STATUS_INDEXED,
        indexed_at: indexedAt,
      })
      .where(inArray(wikiChunks.id, chunkIds))
      .returning();
  }

  protected activateSnapshot(snapshotId: string, spaceId: string, chunkCount: number): Promise<void> {
    return SnapshotManager.activateSnapshot(this.db, snapshotId, spaceId, chunkCount);
  }

  protected markSnapshotFailed(snapshotId: string): Promise<void> {
    return SnapshotManager.markSnapshotFailed(this.db, snapshotId);
  }

  private resolveTargetPage(payload: IndexerPayload, pages: PublishedPageRow[]): PublishedPageRow | undefined {
    if (payload.scope !== 'single_page') {
      return undefined;
    }

    const targetPage = pages.find((row) => row.page.page_id === payload.page_id);
    if (targetPage === undefined) {
      throw new Error(`Published page ${payload.page_id} was not found in space ${payload.space_id}`);
    }

    return targetPage;
  }

  private async planRebuiltSnapshot(
    snapshotId: string,
    embeddingModelId: string,
    pages: PublishedPageRow[],
    previousByPosition: Map<string, PreviousChunkRow>,
  ): Promise<ChunkPlan[]> {
    const plans: ChunkPlan[] = [];

    for (const page of pages) {
      plans.push(...(await this.planPageChunks(snapshotId, embeddingModelId, page, previousByPosition)));
    }

    return plans;
  }

  private async planSinglePageSnapshot(
    payload: IndexerPayload,
    snapshotId: string,
    embeddingModelId: string,
    targetPage: PublishedPageRow | undefined,
    previousChunks: PreviousChunkRow[],
    previousByPosition: Map<string, PreviousChunkRow>,
  ): Promise<ChunkPlan[]> {
    if (targetPage === undefined) {
      throw new Error(`Published page ${payload.page_id} was not found in space ${payload.space_id}`);
    }

    const copiedPlans = previousChunks
      .filter((row) => row.chunk.wiki_page_pk !== targetPage.page.id)
      .map((row) => copyPreviousChunk(row, snapshotId, embeddingModelId));
    const rebuiltPlans = await this.planPageChunks(snapshotId, embeddingModelId, targetPage, previousByPosition);

    return [...copiedPlans, ...rebuiltPlans];
  }

  private async planPageChunks(
    snapshotId: string,
    embeddingModelId: string,
    page: PublishedPageRow,
    previousByPosition: Map<string, PreviousChunkRow>,
  ): Promise<ChunkPlan[]> {
    const [sections, sourceChain, acl] = await Promise.all([
      this.loadSections(page.version.id),
      this.computeSourceChain(page),
      this.buildAcl(page),
    ]);
    const chunks = chunkPage(page.page, page.version, sections);

    return chunks.map((chunk) => {
      const previous = previousByPosition.get(chunkKey(page.page.id, chunk.chunk_index));
      const previousEmbedding = previous?.embedding?.embedding;
      const reusedEmbedding =
        previous?.chunk.content_hash === chunk.content_hash && Array.isArray(previousEmbedding)
          ? previousEmbedding
          : undefined;

      return {
        chunk: {
          id: randomUUID(),
          tenant_id: page.page.tenant_id,
          space_id: page.page.space_id,
          wiki_page_pk: page.page.id,
          page_version_id: page.version.id,
          section_id: chunk.section_id,
          chunk_index: chunk.chunk_index,
          content: chunk.content,
          content_hash: chunk.content_hash,
          token_count: chunk.token_count,
          index_status: INDEX_STATUS_PENDING,
          index_snapshot_id: snapshotId,
          index_version: snapshotId,
          embedding_model_id: embeddingModelId,
          injection_risk: chunk.injection_risk,
          source_chain_json: sourceChain,
          acl_json: acl,
        },
        ...(reusedEmbedding !== undefined ? { reusedEmbedding } : {}),
        ...(previous?.chunk.id !== undefined && reusedEmbedding !== undefined ? { copiedFromChunkId: previous.chunk.id } : {}),
      };
    });
  }

  private async embedAndInsert(chunkPlans: ChunkPlan[], embeddingModelId: string, jobId: string): Promise<void> {
    const embeddingsToInsert: EmbeddingInsert[] = [];
    const chunksNeedingEmbeddings = chunkPlans.filter((plan) => plan.reusedEmbedding === undefined);

    for (const plan of chunkPlans) {
      if (plan.reusedEmbedding === undefined) {
        continue;
      }

      embeddingsToInsert.push(createEmbeddingInsert(plan.chunk, embeddingModelId, plan.reusedEmbedding));
    }

    const totalBatches = Math.ceil(chunksNeedingEmbeddings.length / EMBEDDING_BATCH_SIZE);
    if (totalBatches === 0) {
      await this.recordProgress(jobId, {
        stage: 'embedding_progress',
        batch: 0,
        total_batches: 0,
        embedded_count: 0,
      });
    }

    for (let start = 0; start < chunksNeedingEmbeddings.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = chunksNeedingEmbeddings.slice(start, start + EMBEDDING_BATCH_SIZE);
      const batchNumber = Math.floor(start / EMBEDDING_BATCH_SIZE) + 1;
      const vectors = await this.embeddingProvider.embedBatch(batch.map((plan) => plan.chunk.content));

      if (vectors.length !== batch.length) {
        throw new Error(`Embedding provider returned ${vectors.length} vectors for ${batch.length} chunks`);
      }

      for (const [index, vector] of vectors.entries()) {
        const plan = batch[index];
        if (plan === undefined) {
          throw new Error('Embedding batch index mismatch');
        }

        embeddingsToInsert.push(createEmbeddingInsert(plan.chunk, embeddingModelId, vector));
      }

      await this.recordProgress(jobId, {
        stage: 'embedding_progress',
        batch: batchNumber,
        total_batches: totalBatches,
        embedded_count: Math.min(start + batch.length, chunksNeedingEmbeddings.length),
      });
    }

    await this.insertEmbeddings(embeddingsToInsert);
  }

  private async recordFailureProgress(jobId: string, error: unknown): Promise<void> {
    try {
      await this.recordProgress(jobId, {
        stage: 'indexing_failed',
        error: normalizeErrorMessage(error),
      });
    } catch {
      // Preserve the original processing failure.
    }
  }
}

function buildPreviousChunkMap(previousChunks: PreviousChunkRow[], embeddingModelId: string): Map<string, PreviousChunkRow> {
  const previousByPosition = new Map<string, PreviousChunkRow>();

  for (const row of previousChunks) {
    if (row.chunk.embedding_model_id !== embeddingModelId) {
      continue;
    }

    previousByPosition.set(chunkKey(row.chunk.wiki_page_pk, row.chunk.chunk_index), row);
  }

  return previousByPosition;
}

function chunkKey(pageId: string, chunkIndex: number): string {
  return `${pageId}:${chunkIndex}`;
}

function copyPreviousChunk(row: PreviousChunkRow, snapshotId: string, embeddingModelId: string): ChunkPlan {
  const previousEmbedding = row.embedding?.embedding;
  const reusedEmbedding = Array.isArray(previousEmbedding) ? previousEmbedding : undefined;

  return {
    chunk: {
      id: randomUUID(),
      tenant_id: row.chunk.tenant_id,
      space_id: row.chunk.space_id,
      wiki_page_pk: row.chunk.wiki_page_pk,
      page_version_id: row.chunk.page_version_id,
      section_id: row.chunk.section_id,
      chunk_index: row.chunk.chunk_index,
      content: row.chunk.content,
      content_hash: row.chunk.content_hash,
      token_count: row.chunk.token_count,
      index_status: INDEX_STATUS_PENDING,
      index_snapshot_id: snapshotId,
      index_version: snapshotId,
      embedding_model_id: embeddingModelId,
      injection_risk: row.chunk.injection_risk,
      source_chain_json: row.chunk.source_chain_json,
      acl_json: row.chunk.acl_json,
    },
    ...(reusedEmbedding !== undefined ? { reusedEmbedding } : {}),
    copiedFromChunkId: row.chunk.id,
  };
}

function normalizeSpaceConfig(space: { graphify_config: unknown } | undefined): SpaceConfigInput | undefined {
  if (space === undefined || typeof space.graphify_config !== 'object' || space.graphify_config === null) {
    return undefined;
  }

  return space as SpaceConfigInput;
}

function createEmbeddingInsert(chunk: ChunkPlan['chunk'], embeddingModelId: string, embedding: number[]): EmbeddingInsert {
  return {
    id: randomUUID(),
    tenant_id: chunk.tenant_id,
    space_id: chunk.space_id,
    chunk_id: chunk.id,
    model_config_id: embeddingModelId,
    embedding,
  };
}

function resolveWikiRepoCommitHash(pages: PublishedPageRow[]): string {
  return pages.find((row) => typeof row.version.commit_hash === 'string' && row.version.commit_hash.length > 0)?.version
    .commit_hash ?? 'unknown';
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 1_000);
  }

  return 'Indexing failed';
}
