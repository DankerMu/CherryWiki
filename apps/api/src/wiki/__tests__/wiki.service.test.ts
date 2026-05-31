import { ErrorCode, sourceLinks, wikiPageVersions, wikiPages } from '@cherrygraph/shared';
import { JobRepository, QueueFactory, QUEUE_INDEXING, type JobRow } from '@cherrygraph/job-core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditEntry, AuditService } from '../../audit/audit.service.js';
import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  getHttpExceptionCode,
  getHttpExceptionResponse,
  getRejectedHttpException,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { WikiService, type CreateSourceLinkInput } from '../wiki.service.js';

type WikiPageRow = typeof wikiPages.$inferSelect;
type WikiPageVersionRow = typeof wikiPageVersions.$inferSelect;
type SourceLinkRow = typeof sourceLinks.$inferSelect;

describe('WikiService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listPages returns a paginated response', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([
      {
        page: createPageRow(),
        currentVersion: {
          source: 'graphify',
          frontmatter_json: { tags: ['auth', 'sso'] },
        },
      },
    ]);
    db.queueSelect([{ total: 1 }]);

    const result = await service.listPages(TEST_TENANT_ID, TEST_SPACE_ID, {
      page: 1,
      per_page: 10,
      status: 'published',
      search: 'Auth',
    });

    expect(result.data).toEqual([
      expect.objectContaining({
        page_id: 'page-1',
        source: 'graphify',
        tags: ['auth', 'sso'],
      }),
    ]);
    expect(result.pagination).toEqual({ page: 1, per_page: 10, total: 1, has_next: false });
    expect(db.limitCalls).toContain(10);
  });

  it('listPages falls back to default sort when sort parsing fails', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);
    db.queueSelect([{ total: 0 }]);

    const result = await service.listPages(TEST_TENANT_ID, TEST_SPACE_ID, {
      sort: '-',
    });

    expect(result.data).toEqual([]);
    expect(result.pagination).toEqual({ page: 1, per_page: 20, total: 0, has_next: false });
  });

  it('getPage throws WIKI_PAGE_NOT_FOUND when not found', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(service.getPage(TEST_TENANT_ID, TEST_SPACE_ID, 'missing'));

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.WIKI_PAGE_NOT_FOUND);
  });

  it('getContent returns current version content', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([{ page: createPageRow(), currentVersion: { source: 'graphify', frontmatter_json: {} } }]);
    db.queueSelect([
      createVersionRow({
        frontmatter_json: {
          blocks: [{ block_id: 'summary', owner: 'graphify', editable: false }],
        },
      }),
    ]);

    const result = await service.getContent(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1');

    expect(result).toMatchObject({
      page_id: 'page-1',
      version_id: 'version-1',
      title: 'Auth',
      content_markdown: '# Auth',
      blocks: [{ block_id: 'summary', owner: 'graphify', editable: false }],
    });
    expect(result.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('getContent throws VERSION_NOT_FOUND', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([{ page: createPageRow(), currentVersion: { source: 'graphify', frontmatter_json: {} } }]);
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.getContent(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1', 'missing-version'),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.VERSION_NOT_FOUND);
  });

  it('publishes draft versions, updates current_version_id, and writes audit', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([{ page: createPageRow(), currentVersion: { source: 'graphify', frontmatter_json: {} } }]);
    db.queueSelect([createVersionRow({ status: 'draft' })]);
    db.queueUpdate([createVersionRow({ status: 'published' })]);
    db.queueUpdate([createPageRow({ current_version_id: 'version-1', status: 'published' })]);

    const result = await service.publish(
      TEST_TENANT_ID,
      TEST_SPACE_ID,
      'page-1',
      'version-1',
      'ready',
      TEST_USER_ID,
      { ip: '127.0.0.1' },
    );

    expect(result).toMatchObject({
      page_id: 'page-1',
      version_id: 'version-1',
      status: 'published',
      published_by: TEST_USER_ID,
    });
    expect(db.updates[0]?.value).toMatchObject({ status: 'published' });
    expect(db.updates[1]?.value).toMatchObject({
      current_version_id: 'version-1',
      status: 'published',
    });
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'wiki.page.publish',
        resource_type: 'wiki_page',
        resource_id: 'page-1',
        metadata_json: { version_id: 'version-1', publish_note: 'ready' },
      }) as AuditEntry,
    );
  });

  it('publish throws VERSION_ALREADY_PUBLISHED for already published versions', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([{ page: createPageRow(), currentVersion: { source: 'graphify', frontmatter_json: {} } }]);
    db.queueSelect([createVersionRow({ status: 'published' })]);

    const err = await getRejectedHttpException(
      service.publish(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1', 'version-1', undefined, TEST_USER_ID),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.VERSION_ALREADY_PUBLISHED);
    expect(db.updates).toHaveLength(0);
    expect(audit.push).not.toHaveBeenCalled();
  });

  it('publish returns ILLEGAL_STATUS_TRANSITION for non-draft unpublished versions', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([{ page: createPageRow(), currentVersion: { source: 'graphify', frontmatter_json: {} } }]);
    db.queueSelect([createVersionRow({ status: 'archived' })]);

    const err = await getRejectedHttpException(
      service.publish(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1', 'version-1', undefined, TEST_USER_ID),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionResponse(err)).toEqual({
      code: ErrorCode.ILLEGAL_STATUS_TRANSITION,
      message: 'Wiki page version cannot be published',
    });
    expect(db.updates).toHaveLength(0);
    expect(audit.push).not.toHaveBeenCalled();
  });

  it('unpublish returns ILLEGAL_STATUS_TRANSITION for non-published versions', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([{ page: createPageRow(), currentVersion: { source: 'graphify', frontmatter_json: {} } }]);
    db.queueSelect([createVersionRow({ status: 'archived' })]);

    const err = await getRejectedHttpException(
      service.unpublish(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1', 'version-1', undefined, TEST_USER_ID),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionResponse(err)).toEqual({
      code: ErrorCode.ILLEGAL_STATUS_TRANSITION,
      message: 'Wiki page version cannot be unpublished',
    });
    expect(db.updates).toHaveLength(0);
    expect(audit.push).not.toHaveBeenCalled();
  });

  it('rollback creates a published rollback version, updates current_version_id, and writes audit', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([{ page: createPageRow({ current_version_id: 'version-3' }), currentVersion: null }]);
    db.queueSelect([createVersionRow({ id: 'version-1', content_markdown: '# Previous', version_no: 1 })]);
    db.queueSelect([{ version_no: 1 }, { version_no: 2 }, { version_no: 3 }]);
    db.queueUpdate([createPageRow({ current_version_id: 'rollback-version', status: 'published' })]);

    const result = await service.rollback(
      TEST_TENANT_ID,
      TEST_SPACE_ID,
      'page-1',
      'version-1',
      'restore previous',
      TEST_USER_ID,
    );

    const insertValue = db.inserts[0]?.value as Partial<WikiPageVersionRow>;
    expect(insertValue).toMatchObject({
      wiki_page_pk: 'wiki-page-pk-1',
      page_id: 'page-1',
      version_no: 4,
      content_markdown: '# Previous',
      source: 'rollback',
      status: 'published',
      created_by: TEST_USER_ID,
    });
    expect(result).toMatchObject({
      page_id: 'page-1',
      rolled_back_to: 'version-1',
      new_version_id: insertValue.id,
      status: 'published',
      published_by: TEST_USER_ID,
    });
    expect(db.updates[0]?.value).toMatchObject({
      current_version_id: insertValue.id,
      status: 'published',
    });
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'wiki.page.rollback',
        resource_id: 'page-1',
        metadata_json: {
          target_version_id: 'version-1',
          new_version_id: insertValue.id,
          reason: 'restore previous',
        },
      }) as AuditEntry,
    );
  });

  it('rollback throws VERSION_NOT_FOUND for missing target', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([{ page: createPageRow(), currentVersion: null }]);
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.rollback(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1', 'missing', undefined, TEST_USER_ID),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.VERSION_NOT_FOUND);
  });

  it('creates a single-page reindex job, enqueues it, and writes audit', async () => {
    const { service, db, audit } = createServiceContext({ redis: createRedisMock() });
    const queue = createQueueMock();
    const indexJob = createJobRow({ id: 'job-reindex' });
    db.queueSelect([]);
    db.queueSelect([{ page: createPageRow(), currentVersion: { source: 'graphify', frontmatter_json: {} } }]);
    db.queueSelect([]);
    const createJobSpy = vi.spyOn(JobRepository, 'create').mockResolvedValue(indexJob);
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(queue as never);

    const result = await service.reindexPage(
      TEST_TENANT_ID,
      TEST_SPACE_ID,
      'page-1',
      TEST_USER_ID,
      'idem-key-1',
      { requestId: 'req-1' },
    );

    expect(result).toEqual({
      page_id: 'page-1',
      reindex_job_id: 'job-reindex',
      status: 'accepted',
    });
    expect(createJobSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        space_id: TEST_SPACE_ID,
        queue_name: QUEUE_INDEXING,
        type: 'reindex',
        payload_json: {
          tenant_id: TEST_TENANT_ID,
          space_id: TEST_SPACE_ID,
          page_id: 'page-1',
          trigger: 'manual_reindex',
          scope: 'single_page',
        },
        idempotency_key: 'idem-key-1',
        created_by: TEST_USER_ID,
      }),
    );
    expect(queue.add).toHaveBeenCalledWith('reindex', { jobId: 'job-reindex' });
    expect(queue.close).toHaveBeenCalledTimes(1);
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'wiki.page.reindex',
        resource_type: 'wiki_page',
        resource_id: 'page-1',
        space_id: TEST_SPACE_ID,
        request_id: 'req-1',
        metadata_json: {
          reindex_job_id: 'job-reindex',
          trigger: 'manual_reindex',
          scope: 'single_page',
        },
      }) as AuditEntry,
    );
  });

  it('returns 409 when a building index snapshot already exists for page reindex', async () => {
    const { service, db } = createServiceContext({ redis: createRedisMock() });
    db.queueSelect([{ page: createPageRow(), currentVersion: { source: 'graphify', frontmatter_json: {} } }]);
    db.queueSelect([{ id: 'snapshot-building' }]);

    const err = await getRejectedHttpException(
      service.reindexPage(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1', TEST_USER_ID),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.REINDEX_ALREADY_RUNNING);
  });

  it('returns the idempotent reindex job without creating or enqueueing another job', async () => {
    const { service, db, audit } = createServiceContext({ redis: createRedisMock() });
    const existingJob = createJobRow({ id: 'job-existing', idempotency_key: 'idem-key-1' });
    db.queueSelect([existingJob]);
    const createJobSpy = vi.spyOn(JobRepository, 'create');
    const createQueueSpy = vi.spyOn(QueueFactory, 'createQueue');

    const result = await service.reindexPage(
      TEST_TENANT_ID,
      TEST_SPACE_ID,
      'page-1',
      TEST_USER_ID,
      'idem-key-1',
    );

    expect(result).toEqual({
      page_id: 'page-1',
      reindex_job_id: 'job-existing',
      status: 'accepted',
    });
    expect(createJobSpy).not.toHaveBeenCalled();
    expect(createQueueSpy).not.toHaveBeenCalled();
    expect(audit.push).not.toHaveBeenCalled();
  });

  it('creates source links', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createVersionRow()]);

    const result = await service.createSourceLink(TEST_TENANT_ID, TEST_SPACE_ID, createSourceLinkInput());

    expect(db.inserts[0]?.table).toBe(sourceLinks);
    expect(db.inserts[0]?.value).toMatchObject({
      tenant_id: TEST_TENANT_ID,
      space_id: TEST_SPACE_ID,
      wiki_page_pk: 'wiki-page-pk-1',
      page_version_id: 'version-1',
      evidence_type: 'quote',
    });
    expect(result).toMatchObject({
      wiki_page_pk: 'wiki-page-pk-1',
      page_version_id: 'version-1',
      evidence_type: 'quote',
    });
  });

  it('throws VERSION_NOT_FOUND before creating source links outside scope', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.createSourceLink(TEST_TENANT_ID, TEST_SPACE_ID, createSourceLinkInput({ page_version_id: 'missing' })),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.VERSION_NOT_FOUND);
    expect(db.inserts).toHaveLength(0);
  });

  it('batch creates source links in a transaction', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createVersionRow()]);
    db.queueSelect([createVersionRow({ id: 'version-2', wiki_page_pk: 'wiki-page-pk-2' })]);

    const result = await service.batchCreateSourceLinks(TEST_TENANT_ID, TEST_SPACE_ID, [
      createSourceLinkInput({ evidence_type: 'quote' }),
      createSourceLinkInput({ wiki_page_pk: 'wiki-page-pk-2', page_version_id: 'version-2', evidence_type: '' }),
    ]);

    expect(db.transactionCalls).toBe(1);
    expect(db.inserts[0]?.table).toBe(sourceLinks);
    expect(db.inserts[0]?.value).toEqual([
      expect.objectContaining({ evidence_type: 'quote' }),
      expect.objectContaining({ evidence_type: 'reference' }),
    ]);
    expect(result).toHaveLength(2);
  });

  it('throws VERSION_NOT_FOUND before batch creating source links outside scope', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createVersionRow()]);
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.batchCreateSourceLinks(TEST_TENANT_ID, TEST_SPACE_ID, [
        createSourceLinkInput(),
        createSourceLinkInput({ wiki_page_pk: 'wiki-page-pk-2', page_version_id: 'missing' }),
      ]),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.VERSION_NOT_FOUND);
    expect(db.transactionCalls).toBe(1);
    expect(db.inserts).toHaveLength(0);
  });

  it('queries source links by page version', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([
      {
        link: createSourceLinkRow({ section_id: 'section-pk-1' }),
        section_id: 'page-1#heading-summary',
      },
    ]);

    const result = await service.querySourceLinksByPageVersion(TEST_TENANT_ID, TEST_SPACE_ID, 'version-1');

    expect(result).toEqual([
      expect.objectContaining({
        section_id: 'page-1#heading-summary',
        source_document_id: 'source-1',
        evidence_type: 'quote',
      }),
    ]);
    expect(db.limitCalls).toContain(1000);
  });
});

function createServiceContext(options: { redis?: unknown } = {}): {
  service: WikiService;
  db: ScriptedWikiDb;
  audit: {
    push: ReturnType<typeof vi.fn<(entry: AuditEntry) => void>>;
  };
} {
  const db = new ScriptedWikiDb();
  const audit = {
    push: vi.fn<(entry: AuditEntry) => void>(),
  };
  const service = new WikiService(db.asDrizzle(), audit as unknown as AuditService, options.redis as never);

  return { service, db, audit };
}

function createRedisMock(): {
  get: ReturnType<typeof vi.fn<(key: string) => Promise<string | null>>>;
  set: ReturnType<typeof vi.fn<(key: string, value: string, ...args: Array<string | number>) => Promise<string | null>>>;
  eval: ReturnType<typeof vi.fn<() => Promise<number>>>;
} {
  return {
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve('OK')),
    eval: vi.fn(() => Promise.resolve(1)),
  };
}

function createQueueMock(): {
  add: ReturnType<typeof vi.fn<(name: string, data: { jobId: string }) => Promise<void>>>;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  return {
    add: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
}

type OperationRecord = {
  table?: unknown;
  value?: unknown;
};

class ScriptedWikiDb {
  readonly inserts: OperationRecord[] = [];
  readonly updates: OperationRecord[] = [];
  readonly selectFields: unknown[] = [];
  readonly limitCalls: number[] = [];
  readonly offsetCalls: number[] = [];
  readonly selectResults: unknown[][] = [];
  readonly insertResults: unknown[][] = [];
  readonly updateResults: unknown[][] = [];
  transactionCalls = 0;

  asDrizzle(): NodePgDatabase {
    return this as unknown as NodePgDatabase;
  }

  queueSelect(result: unknown[]): void {
    this.selectResults.push(result);
  }

  queueInsert(result: unknown[]): void {
    this.insertResults.push(result);
  }

  queueUpdate(result: unknown[]): void {
    this.updateResults.push(result);
  }

  transaction<T>(callback: (tx: NodePgDatabase) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return callback(this.asDrizzle());
  }

  select(fields?: unknown): ScriptedQueryBuilder {
    this.selectFields.push(fields);
    return new ScriptedQueryBuilder(this, this.selectResults.shift() ?? []);
  }

  insert(table?: unknown): { values: (value: unknown) => ScriptedMutationBuilder } {
    return {
      values: (value: unknown) => {
        this.inserts.push({ table, value });
        return new ScriptedMutationBuilder(this.insertResults.shift() ?? normalizeInsertedRows(value));
      },
    };
  }

  update(table?: unknown): { set: (value: unknown) => ScriptedMutationBuilder } {
    return {
      set: (value: unknown) => {
        this.updates.push({ table, value });
        return new ScriptedMutationBuilder(this.updateResults.shift() ?? []);
      },
    };
  }
}

class ScriptedQueryBuilder implements PromiseLike<unknown[]> {
  constructor(
    private readonly db: ScriptedWikiDb,
    private readonly result: unknown[],
  ) {}

  from(): this {
    return this;
  }

  leftJoin(): this {
    return this;
  }

  where(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(limit: number): this {
    this.db.limitCalls.push(limit);
    return this;
  }

  offset(offset: number): Promise<unknown[]> {
    this.db.offsetCalls.push(offset);
    return Promise.resolve(this.result);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class ScriptedMutationBuilder implements PromiseLike<unknown[]> {
  constructor(private readonly result: unknown[]) {}

  where(): this {
    return this;
  }

  returning(): Promise<unknown[]> {
    return Promise.resolve(this.result);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function normalizeInsertedRows(value: unknown): unknown[] {
  const values: unknown[] = Array.isArray(value) ? value as unknown[] : [value];
  return values.map((item): unknown => {
    if (typeof item !== 'object' || item === null) {
      return item;
    }

    const record = item as Record<string, unknown>;
    return {
      created_at: new Date('2026-05-01T00:00:00.000Z'),
      ...record,
    };
  });
}

function createPageRow(overrides: Partial<WikiPageRow> = {}): WikiPageRow {
  return {
    id: 'wiki-page-pk-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    page_id: 'page-1',
    title: 'Auth',
    slug: 'auth',
    status: 'published',
    current_version_id: 'version-1',
    indexed_version_id: 'version-1',
    sync_status: 'synced',
    docmost_page_id: null,
    created_by: TEST_USER_ID,
    created_at: new Date('2026-04-30T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createVersionRow(overrides: Partial<WikiPageVersionRow> = {}): WikiPageVersionRow {
  return {
    id: 'version-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    wiki_page_pk: 'wiki-page-pk-1',
    page_id: 'page-1',
    version_no: 1,
    content_markdown: '# Auth',
    frontmatter_json: {},
    source: 'graphify',
    graphify_run_id: 'run-1',
    commit_hash: null,
    status: 'draft',
    created_by: TEST_USER_ID,
    created_at: new Date('2026-04-30T00:00:00.000Z'),
    ...overrides,
  };
}

function createSourceLinkInput(overrides: Partial<CreateSourceLinkInput> = {}): CreateSourceLinkInput {
  return {
    wiki_page_pk: 'wiki-page-pk-1',
    page_version_id: 'version-1',
    section_id: 'section-pk-1',
    source_document_id: 'source-1',
    source_uri: 's3://bucket/source.md',
    quote_hash: 'quote-hash-1',
    evidence_type: 'quote',
    ...overrides,
  };
}

function createSourceLinkRow(overrides: Partial<SourceLinkRow> = {}): SourceLinkRow {
  return {
    id: 'link-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    wiki_page_pk: 'wiki-page-pk-1',
    page_version_id: 'version-1',
    section_id: 'section-pk-1',
    source_document_id: 'source-1',
    source_uri: 's3://bucket/source.md',
    quote_hash: 'quote-hash-1',
    evidence_type: 'quote',
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-reindex',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    queue_name: QUEUE_INDEXING,
    type: 'reindex',
    priority: 100,
    status: 'pending',
    attempt_count: 0,
    max_attempts: 3,
    timeout_seconds: null,
    locked_by: null,
    locked_at: null,
    next_run_at: null,
    cancel_requested_at: null,
    payload_json: {
      tenant_id: TEST_TENANT_ID,
      space_id: TEST_SPACE_ID,
      page_id: 'page-1',
      trigger: 'manual_reindex',
      scope: 'single_page',
    },
    result_json: null,
    error_json: null,
    idempotency_key: null,
    created_by: TEST_USER_ID,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}
