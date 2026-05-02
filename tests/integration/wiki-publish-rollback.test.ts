import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { wikiPageVersions, wikiPages } from '@cherrygraph/shared';
import { describe, expect, it, vi } from 'vitest';

import { IdempotencyMiddleware, type IdempotencyRedisStore } from '../../apps/api/src/common/middleware/idempotency.middleware.js';
import type { AuditService } from '../../apps/api/src/audit/audit.service.js';
import {
  ScriptedDb,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
} from '../../apps/api/src/users/__tests__/user-group-service-test-utils.js';
import { WikiService } from '../../apps/api/src/wiki/wiki.service.js';

type WikiPageRow = typeof wikiPages.$inferSelect;
type WikiPageVersionRow = typeof wikiPageVersions.$inferSelect;

const IDEMPOTENCY_KEY = '123e4567-e89b-42d3-a456-426614174000';

describe('wiki publish and rollback integration', () => {
  it('D11 publish→list shows published page', async () => {
    const { service, db } = createServiceContext();
    const draftPage = createPageRow({
      status: 'draft',
      current_version_id: 'version-1',
      indexed_version_id: null,
    });
    const draftVersion = createVersionRow({
      status: 'draft',
      version_no: 1,
    });
    const publishedPage = createPageRow({
      status: 'published',
      current_version_id: 'version-1',
      indexed_version_id: null,
    });

    db.queueSelect([{ page: draftPage, currentVersion: { source: 'graphify', frontmatter_json: {} } }]);
    db.queueSelect([draftVersion]);
    db.queueUpdate([createVersionRow({ status: 'published' })]);
    db.queueUpdate([publishedPage]);
    db.queueSelect([
      {
        page: publishedPage,
        currentVersion: {
          source: 'graphify',
          frontmatter_json: { tags: ['auth'] },
        },
      },
    ]);
    db.queueSelect([{ total: 1 }]);

    const published = await service.publish(
      TEST_TENANT_ID,
      TEST_SPACE_ID,
      'page-1',
      'version-1',
      'ready',
      TEST_USER_ID,
    );
    const pages = await service.listPages(TEST_TENANT_ID, TEST_SPACE_ID, {
      page: 1,
      per_page: 10,
      status: 'published',
    });

    expect(published).toMatchObject({
      page_id: 'page-1',
      version_id: 'version-1',
      status: 'published',
    });
    expect(pages.data).toEqual([
      expect.objectContaining({
        page_id: 'page-1',
        status: 'published',
        source: 'graphify',
        tags: ['auth'],
      }),
    ]);
    expect(pages.pagination).toEqual({ page: 1, per_page: 10, total: 1, has_next: false });
  });

  it('D12 rollback creates new version with version_no+1', async () => {
    const { service, db } = createServiceContext();
    const originalVersion = createVersionRow({
      id: 'version-1',
      status: 'published',
      version_no: 1,
      content_markdown: '# Published',
    });

    db.queueSelect([
      {
        page: createPageRow({
          status: 'published',
          current_version_id: 'version-1',
        }),
        currentVersion: { source: 'graphify', frontmatter_json: {} },
      },
    ]);
    db.queueSelect([originalVersion]);
    db.queueSelect([{ version_no: originalVersion.version_no }]);
    db.queueUpdate([createPageRow({ status: 'published', current_version_id: 'rollback-version' })]);

    const result = await service.rollback(
      TEST_TENANT_ID,
      TEST_SPACE_ID,
      'page-1',
      'version-1',
      'restore version 1',
      TEST_USER_ID,
    );

    const insertedVersion = db.inserts[0]?.value as Partial<WikiPageVersionRow>;
    expect(db.inserts[0]?.table).toBe(wikiPageVersions);
    expect(insertedVersion.version_no).toBeGreaterThan(originalVersion.version_no);
    expect(insertedVersion).toMatchObject({
      wiki_page_pk: 'wiki-page-pk-1',
      page_id: 'page-1',
      version_no: 2,
      content_markdown: '# Published',
      source: 'rollback',
      status: 'published',
      created_by: TEST_USER_ID,
    });
    expect(result).toMatchObject({
      page_id: 'page-1',
      rolled_back_to: 'version-1',
      new_version_id: insertedVersion.id,
      status: 'published',
      published_by: TEST_USER_ID,
    });
  });

  it('D13 idempotency key publish/rollback returns same result without side effects', async () => {
    const { service, db, audit } = createServiceContext();
    const redis = new MapRedisStore();
    const middleware = new IdempotencyMiddleware(redis);

    db.queueSelect([
      {
        page: createPageRow({ status: 'draft' }),
        currentVersion: { source: 'graphify', frontmatter_json: {} },
      },
    ]);
    db.queueSelect([createVersionRow({ status: 'draft' })]);
    db.queueUpdate([createVersionRow({ status: 'published' })]);
    db.queueUpdate([createPageRow({ status: 'published', current_version_id: 'version-1' })]);

    let publishCalls = 0;
    const publishOnce = async (response: FakeResponse): Promise<void> => {
      publishCalls += 1;
      const result = await service.publish(
        TEST_TENANT_ID,
        TEST_SPACE_ID,
        'page-1',
        'version-1',
        'ready',
        TEST_USER_ID,
      );
      writeJson(response, result);
    };

    const firstPublish = await runIdempotentRequest(middleware, publishPath(), publishOnce);
    await flushPromises();
    const publishUpdateCount = db.updates.length;
    const publishAuditCount = audit.push.mock.calls.length;
    const secondPublish = await runIdempotentRequest(middleware, publishPath(), publishOnce);

    expect(JSON.parse(firstPublish.body)).toMatchObject({
      page_id: 'page-1',
      version_id: 'version-1',
      status: 'published',
    });
    expect(secondPublish.getHeader('x-idempotent-replayed')).toBe('true');
    expect(JSON.parse(secondPublish.body)).toEqual(JSON.parse(firstPublish.body));
    expect(publishCalls).toBe(1);
    expect(db.updates).toHaveLength(publishUpdateCount);
    expect(audit.push).toHaveBeenCalledTimes(publishAuditCount);

    db.queueSelect([
      {
        page: createPageRow({ status: 'published', current_version_id: 'version-1' }),
        currentVersion: { source: 'graphify', frontmatter_json: {} },
      },
    ]);
    db.queueSelect([createVersionRow({ id: 'version-1', status: 'published', version_no: 1 })]);
    db.queueSelect([{ version_no: 1 }]);
    db.queueUpdate([createPageRow({ status: 'published', current_version_id: 'rollback-version' })]);

    let rollbackCalls = 0;
    const rollbackOnce = async (response: FakeResponse): Promise<void> => {
      rollbackCalls += 1;
      const result = await service.rollback(
        TEST_TENANT_ID,
        TEST_SPACE_ID,
        'page-1',
        'version-1',
        'restore',
        TEST_USER_ID,
      );
      writeJson(response, result);
    };

    const firstRollback = await runIdempotentRequest(middleware, rollbackPath(), rollbackOnce);
    await flushPromises();
    const rollbackInsertCount = db.inserts.length;
    const rollbackUpdateCount = db.updates.length;
    const rollbackAuditCount = audit.push.mock.calls.length;
    const secondRollback = await runIdempotentRequest(middleware, rollbackPath(), rollbackOnce);

    expect(JSON.parse(firstRollback.body)).toMatchObject({
      page_id: 'page-1',
      rolled_back_to: 'version-1',
      status: 'published',
    });
    expect(secondRollback.getHeader('x-idempotent-replayed')).toBe('true');
    expect(JSON.parse(secondRollback.body)).toEqual(JSON.parse(firstRollback.body));
    expect(rollbackCalls).toBe(1);
    expect(db.inserts).toHaveLength(rollbackInsertCount);
    expect(db.updates).toHaveLength(rollbackUpdateCount);
    expect(audit.push).toHaveBeenCalledTimes(rollbackAuditCount);
  });
});

function createServiceContext(): {
  service: WikiService;
  db: ScriptedDb;
  audit: ReturnType<typeof createAuditMock>;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  const service = new WikiService(db.asDrizzle(), audit.service as AuditService);

  return { service, db, audit };
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

class MapRedisStore implements IdempotencyRedisStore {
  readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, condition: 'NX', expirationMode: 'EX', _seconds: number): Promise<'OK' | null> {
    expect(condition).toBe('NX');
    expect(expirationMode).toBe('EX');

    if (this.values.has(key)) {
      return Promise.resolve(null);
    }

    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  setex(key: string, _seconds: number, value: string): Promise<'OK'> {
    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  del(key: string): Promise<number> {
    const deleted = this.values.delete(key);
    return Promise.resolve(deleted ? 1 : 0);
  }
}

class FakeResponse extends EventEmitter {
  statusCode = 200;
  readonly headers = new Map<string, string>();
  readonly chunks: Buffer[] = [];

  setHeader(name: string, value: number | string | string[]): this {
    this.headers.set(name.toLowerCase(), Array.isArray(value) ? String(value[0] ?? '') : String(value));
    return this;
  }

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    return true;
  }

  end(chunk?: string | Uint8Array): this {
    if (chunk !== undefined) {
      this.write(chunk);
    }

    this.emit('finish');
    return this;
  }

  get body(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

async function runIdempotentRequest(
  middleware: IdempotencyMiddleware,
  url: string,
  handler: (response: FakeResponse) => Promise<void>,
): Promise<FakeResponse> {
  const response = new FakeResponse();
  let handlerPromise: Promise<void> | undefined;
  await middleware.use(createRequest(url), response as unknown as ServerResponse, () => {
    handlerPromise = handler(response);
  });
  await handlerPromise;
  await flushPromises();
  return response;
}

function createRequest(url: string): IncomingMessage {
  return {
    headers: {
      'x-idempotency-key': IDEMPOTENCY_KEY,
    },
    method: 'POST',
    url,
  } as IncomingMessage;
}

function writeJson(response: FakeResponse, value: unknown): void {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function publishPath(): string {
  return `/api/spaces/${TEST_SPACE_ID}/wiki/pages/page-1/publish`;
}

function rollbackPath(): string {
  return `/api/spaces/${TEST_SPACE_ID}/wiki/pages/page-1/rollback`;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
}
