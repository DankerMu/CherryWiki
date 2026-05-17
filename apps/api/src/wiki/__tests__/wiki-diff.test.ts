import 'reflect-metadata';

import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_METADATA_KEY, RbacGuard } from '@cherrygraph/auth-core';
import { ErrorCode, wikiPageVersions, wikiPages } from '@cherrygraph/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../audit/audit.service.js';
import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { DiffQueryDto } from '../wiki.dto.js';
import { WikiController } from '../wiki.controller.js';
import { WikiService } from '../wiki.service.js';

type WikiPageRow = typeof wikiPages.$inferSelect;
type WikiPageVersionRow = typeof wikiPageVersions.$inferSelect;

describe('Wiki version diff', () => {
  it('returns an empty diff for the same version', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([{ page: createPageRow(), currentVersion: null }]);
    db.queueSelect([createVersionRow()]);

    const result = await service.diffVersions(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1', 'version-1', 'version-1');

    expect(result).toEqual({
      from_version_id: 'version-1',
      to_version_id: 'version-1',
      hunks: [],
      stats: { additions: 0, deletions: 0 },
    });
  });

  it('returns structured hunks and stats for different versions', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([{ page: createPageRow(), currentVersion: null }]);
    db.queueSelect([createVersionRow({ id: 'version-1', content_markdown: '# Auth\nold line\nkept\n' })]);
    db.queueSelect([createVersionRow({ id: 'version-2', content_markdown: '# Auth\nnew line\nkept\nextra\n' })]);

    const result = await service.diffVersions(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1', 'version-1', 'version-2');

    expect(result.stats).toEqual({ additions: 2, deletions: 1 });
    expect(result.hunks.length).toBeGreaterThanOrEqual(1);
    const allLines = result.hunks.flatMap((h) => h.lines);
    expect(allLines).toContain('-old line');
    expect(allLines).toContain('+new line');
    expect(allLines).toContain('+extra');
    expect(allLines).toContain(' # Auth');
    expect(allLines).toContain(' kept');
  });

  it('returns VERSION_NOT_FOUND when either version is missing', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([{ page: createPageRow(), currentVersion: null }]);
    db.queueSelect([createVersionRow({ id: 'version-1' })]);
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.diffVersions(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1', 'version-1', 'missing'),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.VERSION_NOT_FOUND);
  });

  it('returns VERSION_NOT_FOUND for a cross-page version', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([{ page: createPageRow(), currentVersion: null }]);
    db.queueSelect([createVersionRow({ id: 'version-1' })]);
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.diffVersions(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1', 'version-1', 'other-page-version'),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.VERSION_NOT_FOUND);
  });

  it('rejects missing query params with validation errors', async () => {
    const dto = plainToInstance(DiffQueryDto, {});

    const errors = await validate(dto);

    expect(errors.map((error) => error.property).sort()).toEqual(['from_version_id', 'to_version_id']);
  });

  it('dispatches controller requests and requires space:view permission', async () => {
    const service = {
      diffVersions: vi.fn<WikiService['diffVersions']>().mockResolvedValue({
        from_version_id: 'version-1',
        to_version_id: 'version-2',
        hunks: [],
        stats: { additions: 0, deletions: 0 },
      }),
    };
    const controller = new WikiController(service as unknown as WikiService);

    await controller.diffVersions(
      TEST_SPACE_ID,
      'page-1',
      { from_version_id: 'version-1', to_version_id: 'version-2' },
      createRequest(),
    );

    expect(getMetadata('diffVersions')).toEqual(['space:view']);
    expect(service.diffVersions).toHaveBeenCalledWith(
      TEST_TENANT_ID,
      TEST_SPACE_ID,
      'page-1',
      'version-1',
      'version-2',
    );
  });

  it('RBAC rejects diff requests without space:view permission', async () => {
    const guard = new RbacGuard(new Reflector());
    const request = {
      ...createRequest('editor'),
      params: { spaceId: TEST_SPACE_ID },
      space_permissions: {
        [TEST_SPACE_ID]: ['wiki:publish'],
      },
    };

    try {
      await guard.canActivate(createGuardContext('diffVersions', request));
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(403);
      expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
      return;
    }

    throw new Error('Expected RBAC guard to reject missing space:view permission');
  });
});

function createServiceContext(): {
  service: WikiService;
  db: ScriptedWikiDb;
} {
  const db = new ScriptedWikiDb();
  const audit = { push: vi.fn() };
  const service = new WikiService(db.asDrizzle(), audit as unknown as AuditService);
  return { service, db };
}

class ScriptedWikiDb {
  readonly selectResults: unknown[][] = [];

  asDrizzle(): NodePgDatabase {
    return this as unknown as NodePgDatabase;
  }

  queueSelect(result: unknown[]): void {
    this.selectResults.push(result);
  }

  select(): ScriptedQueryBuilder {
    return new ScriptedQueryBuilder(this.selectResults.shift() ?? []);
  }
}

class ScriptedQueryBuilder implements PromiseLike<unknown[]> {
  constructor(private readonly result: unknown[]) {}

  from(): this {
    return this;
  }

  leftJoin(): this {
    return this;
  }

  where(): this {
    return this;
  }

  limit(): Promise<unknown[]> {
    return Promise.resolve(this.result);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function createRequest(role = 'editor'): {
  user: {
    sub: string;
    tenant_id: string;
    email: string;
    role: string;
    group_ids: string[];
    token_use: 'access';
  };
} {
  return {
    user: {
      sub: TEST_USER_ID,
      tenant_id: TEST_TENANT_ID,
      email: 'user@example.com',
      role,
      group_ids: ['group-1'],
      token_use: 'access',
    },
  };
}

function createGuardContext(methodName: keyof WikiController, request: unknown): ExecutionContext {
  const descriptor = Object.getOwnPropertyDescriptor(WikiController.prototype, methodName);
  return {
    getHandler: () => descriptor?.value as () => unknown,
    getClass: () => WikiController,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function getMetadata(methodName: keyof WikiController): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(WikiController.prototype, methodName);
  return Reflect.getMetadata(PERMISSIONS_METADATA_KEY, descriptor?.value as object);
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
