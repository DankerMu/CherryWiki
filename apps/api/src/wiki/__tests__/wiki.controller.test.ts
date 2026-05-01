import 'reflect-metadata';

import { HttpException, HttpStatus } from '@nestjs/common';
import { PERMISSIONS_METADATA_KEY } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  getHttpExceptionCode,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { buildPaginationMeta, paginatedResponse, type PaginatedResponse } from '../../common/dto/pagination.dto.js';
import { WikiController } from '../wiki.controller.js';
import type { WikiService } from '../wiki.service.js';

describe('WikiController', () => {
  it('applies wiki permissions on routes', () => {
    expect(getMetadata('listPages')).toEqual(['space:view']);
    expect(getMetadata('getPage')).toEqual(['space:view']);
    expect(getMetadata('getContent')).toEqual(['space:view']);
    expect(getMetadata('listVersions')).toEqual(['space:view']);
    expect(getMetadata('publish')).toEqual(['wiki:publish']);
    expect(getMetadata('rollback')).toEqual(['wiki:rollback']);
  });

  it('dispatches list pages requests to the service', async () => {
    const { controller, service } = createControllerContext();
    const query = { page: 2, per_page: 10, sort: '-updated_at', status: 'published', search: 'auth' };
    service.listPages.mockResolvedValue(createPaginatedResult([]));

    await controller.listPages(TEST_SPACE_ID, query, createRequest());

    expect(service.listPages).toHaveBeenCalledWith(TEST_TENANT_ID, TEST_SPACE_ID, query);
  });

  it('dispatches get page requests to the service', async () => {
    const { controller, service } = createControllerContext();
    service.getPage.mockResolvedValue(createPageResponse());

    const result = await controller.getPage(TEST_SPACE_ID, 'page-1', createRequest());

    expect(result.page_id).toBe('page-1');
    expect(service.getPage).toHaveBeenCalledWith(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1');
  });

  it('dispatches get content requests to the service', async () => {
    const { controller, service } = createControllerContext();
    service.getContent.mockResolvedValue({
      page_id: 'page-1',
      version_id: 'version-1',
      title: 'Auth',
      content_markdown: '# Auth',
      content_hash: 'sha256:hash',
      blocks: [],
    });

    await controller.getContent(TEST_SPACE_ID, 'page-1', 'version-1', createRequest());

    expect(service.getContent).toHaveBeenCalledWith(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1', 'version-1');
  });

  it('dispatches list version requests to the service', async () => {
    const { controller, service } = createControllerContext();
    const query = { page: 1, per_page: 20, sort: '-created_at' };
    service.listVersions.mockResolvedValue(createPaginatedResult([]));

    await controller.listVersions(TEST_SPACE_ID, 'page-1', query, createRequest());

    expect(service.listVersions).toHaveBeenCalledWith(TEST_TENANT_ID, TEST_SPACE_ID, 'page-1', query);
  });

  it('dispatches publish requests with actor and audit context', async () => {
    const { controller, service } = createControllerContext();
    service.publish.mockResolvedValue({
      page_id: 'page-1',
      version_id: 'version-1',
      status: 'published',
      published_at: new Date('2026-05-01T00:00:00.000Z'),
      published_by: TEST_USER_ID,
    });

    await controller.publish(
      TEST_SPACE_ID,
      'page-1',
      { version_id: 'version-1', publish_note: 'ready' },
      createRequest(),
    );

    expect(service.publish).toHaveBeenCalledWith(
      TEST_TENANT_ID,
      TEST_SPACE_ID,
      'page-1',
      'version-1',
      'ready',
      TEST_USER_ID,
      expect.objectContaining({
        ip: '127.0.0.1',
        userAgent: 'vitest',
        requestId: 'req-1',
      }) as Record<string, unknown>,
    );
  });

  it('dispatches rollback requests with actor and audit context', async () => {
    const { controller, service } = createControllerContext();
    service.rollback.mockResolvedValue({
      page_id: 'page-1',
      rolled_back_to: 'version-1',
      new_version_id: 'version-2',
      status: 'published',
      published_at: new Date('2026-05-01T00:00:00.000Z'),
      published_by: TEST_USER_ID,
    });

    await controller.rollback(
      TEST_SPACE_ID,
      'page-1',
      { target_version_id: 'version-1', reason: 'bad publish' },
      createRequest(),
    );

    expect(service.rollback).toHaveBeenCalledWith(
      TEST_TENANT_ID,
      TEST_SPACE_ID,
      'page-1',
      'version-1',
      'bad publish',
      TEST_USER_ID,
      expect.objectContaining({
        requestId: 'req-1',
      }) as Record<string, unknown>,
    );
  });

  it.each([
    {
      method: 'getPage' as const,
      code: ErrorCode.WIKI_PAGE_NOT_FOUND,
      invoke: (controller: WikiController) => controller.getPage(TEST_SPACE_ID, 'missing', createRequest()),
    },
    {
      method: 'getContent' as const,
      code: ErrorCode.VERSION_NOT_FOUND,
      invoke: (controller: WikiController) => controller.getContent(TEST_SPACE_ID, 'page-1', 'missing', createRequest()),
    },
    {
      method: 'publish' as const,
      code: ErrorCode.VERSION_ALREADY_PUBLISHED,
      invoke: (controller: WikiController) =>
        controller.publish(TEST_SPACE_ID, 'page-1', { version_id: 'version-1' }, createRequest()),
    },
  ])('propagates $code errors from $method', async ({ method, code, invoke }) => {
    const { controller, service } = createControllerContext();
    const err = new HttpException({ code, message: 'nope' }, HttpStatus.CONFLICT);
    service[method].mockRejectedValue(err);

    await expect(invoke(controller)).rejects.toBe(err);
  });

  it('returns 401 for unauthenticated requests', async () => {
    const { controller } = createControllerContext();

    try {
      await controller.getPage(TEST_SPACE_ID, 'page-1', {});
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(401);
      expect(getHttpExceptionCode(err)).toBe(ErrorCode.UNAUTHENTICATED);
      return;
    }

    throw new Error('Expected controller to reject unauthenticated request');
  });
});

function createControllerContext(): {
  controller: WikiController;
  service: {
    listPages: ReturnType<typeof vi.fn<WikiService['listPages']>>;
    getPage: ReturnType<typeof vi.fn<WikiService['getPage']>>;
    getContent: ReturnType<typeof vi.fn<WikiService['getContent']>>;
    listVersions: ReturnType<typeof vi.fn<WikiService['listVersions']>>;
    publish: ReturnType<typeof vi.fn<WikiService['publish']>>;
    rollback: ReturnType<typeof vi.fn<WikiService['rollback']>>;
  };
} {
  const service = {
    listPages: vi.fn<WikiService['listPages']>(),
    getPage: vi.fn<WikiService['getPage']>(),
    getContent: vi.fn<WikiService['getContent']>(),
    listVersions: vi.fn<WikiService['listVersions']>(),
    publish: vi.fn<WikiService['publish']>(),
    rollback: vi.fn<WikiService['rollback']>(),
  };

  return {
    controller: new WikiController(service as unknown as WikiService),
    service,
  };
}

function createRequest(): {
  user: {
    sub: string;
    tenant_id: string;
    email: string;
    role: string;
    group_ids: string[];
    token_use: 'access';
  };
  ip: string;
  headers: Record<string, string>;
} {
  return {
    user: {
      sub: TEST_USER_ID,
      tenant_id: TEST_TENANT_ID,
      email: 'user@example.com',
      role: 'editor',
      group_ids: ['group-1'],
      token_use: 'access',
    },
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'vitest',
      'x-request-id': 'req-1',
    },
  };
}

function createPageResponse(): Awaited<ReturnType<WikiService['getPage']>> {
  return {
    page_id: 'page-1',
    space_id: TEST_SPACE_ID,
    title: 'Auth',
    status: 'published',
    source: 'graphify',
    current_version_id: 'version-1',
    indexed_version_id: 'version-1',
    sync_status: 'synced',
    docmost_page_id: null,
    tags: [],
    citations_count: 0,
    related_nodes_count: 0,
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
  };
}

function createPaginatedResult<T>(data: T[]): PaginatedResponse<T> {
  return paginatedResponse(data, buildPaginationMeta(1, 20, data.length));
}

function getMetadata(methodName: keyof WikiController): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(WikiController.prototype, methodName);
  return Reflect.getMetadata(PERMISSIONS_METADATA_KEY, descriptor?.value as object);
}
