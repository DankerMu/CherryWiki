import type { Job as BullMQJob } from 'bullmq';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddingProvider } from '@cherrygraph/ai-core';
import type { JobDatabase, JobRow, RedisJobLockClient } from '@cherrygraph/job-core';
import { JobStatus } from '@cherrygraph/job-core';
import {
  embeddings,
  wikiChunks,
  wikiPageVersions,
  wikiPages,
  wikiSections,
} from '@cherrygraph/shared';

import type { IndexerPayload } from '../indexer-payload.js';
import { IndexerWorker } from '../indexer-worker.js';
import type { IndexSnapshotRow } from '../snapshot-manager.js';

const now = new Date('2026-05-03T00:00:00.000Z');
const modelConfigId = 'model-config-1';

describe('IndexerWorker', () => {
  let embeddingProvider: MockEmbeddingProvider;
  let worker: HarnessIndexerWorker;

  beforeEach(() => {
    embeddingProvider = new MockEmbeddingProvider();
    worker = new HarnessIndexerWorker(embeddingProvider);
  });

  it('4.T1 validates job payloads', async () => {
    worker.pages = [createPublishedPage('page-1', 'hello')];

    await expect(worker.run(createJob())).resolves.toMatchObject({ chunk_count: 1 });

    await expect(
      worker.run(
        createJob({
          payload_json: {
            space_id: 'space-1',
            trigger: 'manual_rebuild',
            scope: 'full',
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('4.T2 runs the full flow for 10 pages and indexes all chunks', async () => {
    worker.pages = Array.from({ length: 10 }, (_, pageIndex) => createPublishedPage(`page-${pageIndex}`, 'unused'));
    worker.sectionsByVersion = new Map(
      worker.pages.map((page, pageIndex) => [
        page.version.id,
        Array.from({ length: 5 }, (_, sectionIndex) =>
          createSection(page, sectionIndex, `page ${pageIndex} section ${sectionIndex}`),
        ),
      ]),
    );

    const result = await worker.run(createJob());

    expect(result.chunk_count).toBe(50);
    expect(worker.insertedChunks).toHaveLength(50);
    expect(worker.insertedEmbeddings).toHaveLength(50);
    expect(worker.insertedChunks.every((chunk) => chunk.index_status === 'indexed')).toBe(true);
    expect(worker.snapshots.at(-1)).toMatchObject({
      id: result.snapshot_id,
      status: 'activated',
      chunk_count: 50,
    });
    expect(worker.activeSnapshotId).toBe(result.snapshot_id);
  });

  it('4.T3 excludes draft pages from chunking', async () => {
    worker.pages = [createPublishedPage('published', 'public content'), createPublishedPage('draft', 'draft content', 'draft')];

    await worker.run(createJob());

    expect(worker.insertedChunks).toHaveLength(1);
    expect(worker.insertedChunks[0]?.wiki_page_pk).toBe('published-pk');
  });

  it('4.T4 moves snapshots through ready, activated, and superseded states', async () => {
    worker.snapshots = [createSnapshot('old-snapshot', 'activated')];
    worker.activeSnapshotId = 'old-snapshot';
    worker.pages = [createPublishedPage('page-1', 'hello')];

    const result = await worker.run(createJob());

    expect(worker.statusTransitions).toEqual([
      { snapshotId: result.snapshot_id, status: 'ready' },
      { snapshotId: result.snapshot_id, status: 'activated' },
      { snapshotId: 'old-snapshot', status: 'superseded' },
    ]);
    expect(worker.snapshots.find((snapshot) => snapshot.id === 'old-snapshot')?.status).toBe('superseded');
  });

  it('4.T5 reuses embeddings when content_hash matches the active snapshot', async () => {
    const page = createPublishedPage('page-1', 'unchanged');
    worker.pages = [page];
    worker.snapshots = [createSnapshot('old-snapshot', 'activated')];
    worker.activeSnapshotId = 'old-snapshot';
    worker.previousChunks = [
      createPreviousChunk(page, {
        content: 'unchanged',
        content_hash: hashContent('unchanged'),
        embedding: [0.25, 0.75],
      }),
    ];

    await worker.run(createJob());

    expect(embeddingProvider.embedBatch).not.toHaveBeenCalled();
    expect(worker.insertedEmbeddings).toHaveLength(1);
    expect(worker.insertedEmbeddings[0]?.embedding).toEqual([0.25, 0.75]);
  });

  it('4.T6 activates atomically and leaves the active snapshot unchanged when activation fails', async () => {
    worker.snapshots = [createSnapshot('old-snapshot', 'activated')];
    worker.activeSnapshotId = 'old-snapshot';
    worker.pages = [createPublishedPage('page-1', 'hello')];

    await worker.run(createJob());
    expect(worker.activeSnapshotId).not.toBe('old-snapshot');

    const failingWorker = new HarnessIndexerWorker(new MockEmbeddingProvider());
    failingWorker.snapshots = [createSnapshot('old-snapshot', 'activated')];
    failingWorker.activeSnapshotId = 'old-snapshot';
    failingWorker.pages = [createPublishedPage('page-1', 'hello')];
    failingWorker.failActivation = true;

    await expect(failingWorker.run(createJob())).rejects.toThrow('activation failed');
    expect(failingWorker.activeSnapshotId).toBe('old-snapshot');
    expect(failingWorker.snapshots.at(-1)?.status).toBe('building');
  });

  it('does not reset the snapshot when a failure occurs after activation commits', async () => {
    worker.snapshots = [createSnapshot('old-snapshot', 'activated')];
    worker.activeSnapshotId = 'old-snapshot';
    worker.pages = [createPublishedPage('page-1', 'hello')];
    worker.failProgressStage = 'snapshot_activated';

    await expect(worker.run(createJob())).rejects.toThrow('progress failed');

    const newSnapshot = worker.snapshots.at(-1);
    expect(worker.activeSnapshotId).toBe(newSnapshot?.id);
    expect(newSnapshot?.status).toBe('activated');
    expect(newSnapshot?.activated_at).toBe(now);
    expect(worker.snapshots.find((snapshot) => snapshot.id === 'old-snapshot')?.status).toBe('superseded');
  });

  it('4.T7 isolates embedding failures from the active snapshot', async () => {
    worker.snapshots = [createSnapshot('old-snapshot', 'activated')];
    worker.activeSnapshotId = 'old-snapshot';
    worker.pages = [createPublishedPage('page-1', 'hello')];
    embeddingProvider.embedBatch.mockRejectedValueOnce(new Error('embedding unavailable'));

    await expect(worker.run(createJob())).rejects.toThrow('embedding unavailable');

    expect(worker.activeSnapshotId).toBe('old-snapshot');
    expect(worker.snapshots.at(-1)?.status).toBe('building');
    expect(worker.insertedChunks.every((chunk) => chunk.index_status === 'pending')).toBe(true);
  });

  it('4.T8 rejects concurrent indexing for the same space', async () => {
    worker.buildingExists = true;
    worker.pages = [createPublishedPage('page-1', 'hello')];

    await expect(worker.run(createJob())).rejects.toMatchObject({ code: 'INDEXING_IN_PROGRESS' });
    expect(worker.snapshots).toHaveLength(0);
  });

  it('4.T9 records progress events for each indexing stage', async () => {
    worker.pages = [createPublishedPage('page-1', 'hello')];

    const result = await worker.run(createJob());

    expect(worker.events.map((event) => event.stage)).toEqual([
      'indexing_started',
      'chunks_created',
      'embedding_progress',
      'snapshot_activated',
    ]);
    expect(worker.events.at(-1)).toMatchObject({ snapshot_id: result.snapshot_id });
  });

  it('4.T10 rebuilds only the target page and copies other chunks for single_page scope', async () => {
    const target = createPublishedPage('target', 'new target content');
    const other = createPublishedPage('other', 'other content');
    worker.pages = [target, other];
    worker.snapshots = [createSnapshot('old-snapshot', 'activated')];
    worker.activeSnapshotId = 'old-snapshot';
    worker.previousChunks = [
      createPreviousChunk(target, {
        content: 'old target content',
        content_hash: hashContent('old target content'),
        embedding: [1, 1],
      }),
      createPreviousChunk(other, {
        content: 'old other content',
        content_hash: hashContent('old other content'),
        embedding: [2, 2],
      }),
    ];

    await worker.run(
      createJob({
        payload_json: createPayload({
          scope: 'single_page',
          trigger: 'manual_reindex',
          page_id: 'target',
        }),
      }),
    );

    expect(worker.insertedChunks).toHaveLength(2);
    expect(worker.insertedChunks.find((chunk) => chunk.wiki_page_pk === 'target-pk')?.content).toBe('new target content');
    expect(worker.insertedChunks.find((chunk) => chunk.wiki_page_pk === 'other-pk')?.content).toBe('old other content');
    expect(embeddingProvider.embedBatch).toHaveBeenCalledTimes(1);
  });

  it('4.T11 marks chunks indexed only after embeddings are written', async () => {
    worker.pages = [createPublishedPage('page-1', 'hello')];
    await worker.run(createJob());

    expect(worker.insertedChunks[0]?.index_status).toBe('indexed');
    expect(worker.insertedChunks[0]?.indexed_at).toBeInstanceOf(Date);

    const failingWorker = new HarnessIndexerWorker(new MockEmbeddingProvider());
    failingWorker.pages = [createPublishedPage('page-1', 'hello')];
    failingWorker.mockEmbeddingProvider.embedBatch.mockRejectedValueOnce(new Error('embedding failed'));

    await expect(failingWorker.run(createJob())).rejects.toThrow('embedding failed');
    expect(failingWorker.insertedChunks[0]?.index_status).toBe('pending');
    expect(failingWorker.insertedChunks[0]?.indexed_at).toBeNull();
  });
});

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly embedBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map((_, index) => [index, index + 1])));

  getModelId(): string {
    return 'text-embedding-test';
  }
}

class HarnessIndexerWorker extends IndexerWorker {
  pages: PageRow[] = [];
  sectionsByVersion = new Map<string, SectionRow[]>();
  snapshots: IndexSnapshotRow[] = [];
  previousChunks: PreviousChunkRow[] = [];
  insertedChunks: ChunkInsert[] = [];
  insertedEmbeddings: EmbeddingInsert[] = [];
  events: Array<Record<string, unknown>> = [];
  statusTransitions: Array<{ snapshotId: string; status: string }> = [];
  activeSnapshotId: string | undefined;
  buildingExists = false;
  failActivation = false;
  failProgressStage: string | undefined;

  constructor(readonly mockEmbeddingProvider: MockEmbeddingProvider) {
    super({} as JobDatabase, new RedisStub(), mockEmbeddingProvider, 'indexer-worker-test');
  }

  run(job: JobRow): Promise<{ snapshot_id: string; chunk_count: number }> {
    return this.process(job, { id: 'bull-1', data: { jobId: job.id } } as BullMQJob<
      { jobId: string },
      { snapshot_id: string; chunk_count: number },
      string
    >);
  }

  protected override recordProgress(_jobId: string, detail: Record<string, unknown>): Promise<void> {
    if (detail.stage === this.failProgressStage) {
      return Promise.reject(new Error('progress failed'));
    }

    this.events.push(detail);
    return Promise.resolve();
  }

  protected override checkBuildingExists(spaceId: string): Promise<boolean> {
    void spaceId;

    return Promise.resolve(this.buildingExists);
  }

  protected override resolveEmbeddingModel(tenantId: string): Promise<ModelConfigRow> {
    void tenantId;

    return Promise.resolve({
      id: modelConfigId,
      provider: 'openai',
      model_id: 'text-embedding-test',
      base_url: null,
      encrypted_api_key_ref: 'OPENAI_API_KEY',
      embedding_dim: 2,
    });
  }

  protected override createSnapshot(
    payload: IndexerPayload,
    embeddingModelId: string,
    wikiRepoCommitHash: string,
  ): Promise<IndexSnapshotRow> {
    const snapshot = createSnapshot(`snapshot-${this.snapshots.length + 1}`, 'building', {
      tenant_id: payload.tenant_id,
      space_id: payload.space_id,
      graphify_run_id: payload.graphify_run_id ?? null,
      embedding_model_id: embeddingModelId,
      wiki_repo_commit_hash: wikiRepoCommitHash,
    });
    this.snapshots.push(snapshot);
    return Promise.resolve(snapshot);
  }

  protected override loadActiveSnapshot(spaceId: string): Promise<IndexSnapshotRow | undefined> {
    void spaceId;

    return Promise.resolve(this.snapshots.find((snapshot) => snapshot.id === this.activeSnapshotId));
  }

  protected override loadPublishedPages(payload: IndexerPayload): Promise<PageRow[]> {
    const publishedPages = this.pages.filter((row) => row.version.status === 'published');
    if (payload.scope === 'single_page') {
      return Promise.resolve(publishedPages.filter((row) => row.page.page_id === payload.page_id));
    }

    return Promise.resolve(publishedPages);
  }

  protected override loadSections(pageVersionId: string): Promise<SectionRow[]> {
    return Promise.resolve(this.sectionsByVersion.get(pageVersionId) ?? []);
  }

  protected override loadSnapshotChunks(spaceId: string, snapshotId: string): Promise<PreviousChunkRow[]> {
    void spaceId;

    return Promise.resolve(this.previousChunks.filter((row) => row.chunk.index_snapshot_id === snapshotId));
  }

  protected override computeSourceChain(page: PageRow) {
    void page;

    return Promise.resolve({
      source_document_ids: [],
      graph_node_ids: [],
      graph_edge_ids: [],
      edge_confidences: [],
      chain_confidence: 1,
    });
  }

  protected override buildAcl(page: PageRow) {
    return Promise.resolve({
      tenant_id: page.page.tenant_id,
      space_id: page.page.space_id,
      allowed_group_ids: [],
      classification: 'internal',
      page_id: page.page.page_id,
      page_version: page.version.version_no,
    });
  }

  protected override insertChunks(chunks: ChunkInsert[]): Promise<unknown> {
    this.insertedChunks.push(...chunks.map((chunk) => ({ ...chunk, indexed_at: chunk.indexed_at ?? null })));
    return Promise.resolve([]);
  }

  protected override insertEmbeddings(rows: EmbeddingInsert[]): Promise<unknown> {
    this.insertedEmbeddings.push(...rows);
    return Promise.resolve([]);
  }

  protected override markChunksIndexed(chunkIds: string[], indexedAt: Date): Promise<unknown> {
    for (const chunk of this.insertedChunks) {
      if (chunkIds.includes(chunk.id)) {
        chunk.index_status = 'indexed';
        chunk.indexed_at = indexedAt;
      }
    }

    return Promise.resolve([]);
  }

  protected override markSnapshotReady(snapshotId: string, chunkCount: number): Promise<void> {
    const snapshot = this.snapshots.find((item) => item.id === snapshotId);
    if (snapshot !== undefined) {
      snapshot.status = 'ready';
      snapshot.chunk_count = chunkCount;
      this.statusTransitions.push({ snapshotId, status: 'ready' });
    }

    return Promise.resolve();
  }

  protected override activateSnapshot(snapshotId: string, spaceId: string): Promise<void> {
    void spaceId;

    if (this.failActivation) {
      return Promise.reject(new Error('activation failed'));
    }

    const newSnapshot = this.snapshots.find((snapshot) => snapshot.id === snapshotId);
    if (newSnapshot !== undefined) {
      newSnapshot.status = 'activated';
      newSnapshot.activated_at = now;
      this.statusTransitions.push({ snapshotId: newSnapshot.id, status: 'activated' });
    }

    for (const snapshot of this.snapshots) {
      if (snapshot.id !== snapshotId && snapshot.status === 'activated') {
        snapshot.status = 'superseded';
        this.statusTransitions.push({ snapshotId: snapshot.id, status: 'superseded' });
      }
    }

    this.activeSnapshotId = snapshotId;
    return Promise.resolve();
  }

  protected override resetSnapshotToBuilding(snapshotId: string): Promise<void> {
    const snapshot = this.snapshots.find((item) => item.id === snapshotId);
    if (snapshot !== undefined) {
      snapshot.status = 'building';
      snapshot.activated_at = null;
    }

    return Promise.resolve();
  }
}

class RedisStub implements RedisJobLockClient {
  get(key: string): Promise<string | null> {
    void key;

    return Promise.resolve(null);
  }

  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null> {
    void key;
    void value;
    void args;

    return Promise.resolve('OK');
  }

  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<number | string | null> {
    void script;
    void numKeys;
    void args;

    return Promise.resolve(1);
  }
}

type PageRow = {
  page: typeof wikiPages.$inferSelect;
  version: typeof wikiPageVersions.$inferSelect;
};

type SectionRow = typeof wikiSections.$inferSelect;
type ChunkInsert = typeof wikiChunks.$inferInsert & { id: string; content: string };
type EmbeddingInsert = typeof embeddings.$inferInsert;
type PreviousChunkRow = {
  chunk: typeof wikiChunks.$inferSelect;
  embedding: typeof embeddings.$inferSelect | null;
};
type ModelConfigRow = {
  id: string;
  provider: string;
  model_id: string;
  base_url: string | null;
  encrypted_api_key_ref: string | null;
  embedding_dim: number | null;
};

function createJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    queue_name: 'indexer',
    type: 'reindex',
    priority: 100,
    status: JobStatus.RUNNING,
    attempt_count: 0,
    max_attempts: 3,
    timeout_seconds: 600,
    locked_by: 'worker-1',
    locked_at: now,
    next_run_at: null,
    cancel_requested_at: null,
    payload_json: createPayload(),
    result_json: null,
    error_json: null,
    idempotency_key: null,
    created_by: 'user-1',
    created_at: now,
    started_at: now,
    completed_at: null,
    ...overrides,
  };
}

function createPayload(overrides: Partial<IndexerPayload> = {}): IndexerPayload {
  return {
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    trigger: 'manual_rebuild',
    scope: 'full',
    ...overrides,
  };
}

function createPublishedPage(pageId: string, content: string, status = 'published'): PageRow {
  return {
    page: {
      id: `${pageId}-pk`,
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      page_id: pageId,
      title: pageId,
      slug: pageId,
      status,
      current_version_id: `${pageId}-version`,
      indexed_version_id: null,
      sync_status: 'synced',
      docmost_page_id: null,
      created_by: null,
      created_at: now,
      updated_at: now,
    },
    version: {
      id: `${pageId}-version`,
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      wiki_page_pk: `${pageId}-pk`,
      page_id: pageId,
      version_no: 1,
      content_markdown: content,
      frontmatter_json: {},
      source: 'graphify',
      graphify_run_id: null,
      commit_hash: 'commit-1',
      status,
      created_by: null,
      created_at: now,
    },
  };
}

function createSection(page: PageRow, sectionIndex: number, content: string): SectionRow {
  return {
    id: `${page.page.id}-section-${sectionIndex}`,
    tenant_id: page.page.tenant_id,
    space_id: page.page.space_id,
    wiki_page_pk: page.page.id,
    page_version_id: page.version.id,
    section_id: `section-${sectionIndex}`,
    heading: `Section ${sectionIndex}`,
    level: 2,
    section_index: sectionIndex,
    start_offset: null,
    end_offset: null,
    content_hash: hashContent(content),
    acl_json: {},
    created_at: now,
    content,
  } as SectionRow & { content: string };
}

function createSnapshot(
  id: string,
  status: string,
  overrides: Partial<IndexSnapshotRow> = {},
): IndexSnapshotRow {
  return {
    id,
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    graphify_run_id: null,
    wiki_repo_commit_hash: 'commit-1',
    embedding_model_id: modelConfigId,
    chunk_count: 0,
    node_count: 0,
    edge_count: 0,
    status,
    created_at: now,
    activated_at: status === 'activated' ? now : null,
    ...overrides,
  };
}

function createPreviousChunk(
  page: PageRow,
  overrides: {
    content: string;
    content_hash: string;
    embedding: number[];
  },
): PreviousChunkRow {
  const chunkId = `${page.page.page_id}-old-chunk`;

  return {
    chunk: {
      id: chunkId,
      tenant_id: page.page.tenant_id,
      space_id: page.page.space_id,
      wiki_page_pk: page.page.id,
      page_version_id: page.version.id,
      section_id: null,
      chunk_index: 0,
      content: overrides.content,
      content_hash: overrides.content_hash,
      token_count: 1,
      index_status: 'indexed',
      index_snapshot_id: 'old-snapshot',
      index_version: 'old-snapshot',
      indexed_at: now,
      embedding_model_id: modelConfigId,
      injection_risk: false,
      source_chain_json: {},
      acl_json: {},
      created_at: now,
    },
    embedding: {
      id: `${chunkId}-embedding`,
      tenant_id: page.page.tenant_id,
      space_id: page.page.space_id,
      chunk_id: chunkId,
      model_config_id: modelConfigId,
      embedding: overrides.embedding,
      created_at: now,
    },
  };
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
