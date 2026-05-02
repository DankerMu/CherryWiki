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
import { GraphifyController } from '../graphify.controller.js';
import type { GraphifyService } from '../graphify.service.js';

describe('GraphifyController', () => {
  it('applies route permissions where the guard can authorize before resource lookup', () => {
    expect(getMetadata('createRun')).toEqual(['graphify:run']);
    expect(getMetadata('getGraphSummary')).toEqual(['admin']);
    expect(getMetadata('adminListRuns')).toEqual(['admin']);
    expect(getMetadata('adminRetryRun')).toEqual(['admin']);
  });

  it('dispatches create run requests to the service', async () => {
    const { controller, service } = createControllerContext();
    service.createRun.mockResolvedValue(createRunResponse());

    const result = await controller.createRun(
      TEST_SPACE_ID,
      { mode: 'full', trigger_type: 'manual' },
      createRequest(),
    );

    expect(result.run_id).toBe('run-1');
    expect(service.createRun).toHaveBeenCalledWith(
      TEST_SPACE_ID,
      { mode: 'full', trigger_type: 'manual' },
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        actorUserId: TEST_USER_ID,
        audit: expect.objectContaining({ requestId: 'req-1' }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });

  it('dispatches list runs requests to the service', async () => {
    const { controller, service } = createControllerContext();
    const query = { page: 1, per_page: 20, sort: '-created_at', status: 'succeeded' as const };
    service.listRuns.mockResolvedValue(createPaginatedResult([createRunResponse({ status: 'succeeded' })]));

    await controller.listRuns(query, createRequest());

    expect(service.listRuns).toHaveBeenCalledWith(query, expect.objectContaining({ tenantId: TEST_TENANT_ID }));
  });

  it('dispatches run detail, cancel, retry, report, and graph requests', async () => {
    const { controller, service } = createControllerContext();
    service.getRun.mockResolvedValue(createRunResponse());
    service.cancelRun.mockResolvedValue({ run_id: 'run-1', status: 'cancelling' });
    service.retryRun.mockResolvedValue(createRunResponse({ run_id: 'run-2' }));
    service.getReport.mockResolvedValue({
      run_id: 'run-1',
      report_format: 'markdown',
      content: '# Report',
      generated_at: new Date('2026-05-01T00:00:00.000Z'),
    });
    service.getGraphSummary.mockResolvedValue({
      run_id: 'run-1',
      summary: { node_count: 1, edge_count: 2, community_count: 3 },
      top_entities: [],
      schema_version: 'v1',
    });

    await controller.getRun('run-1', createRequest());
    await controller.cancelRun('run-1', createRequest());
    await controller.retryRun('run-1', createRequest());
    await controller.getReport('run-1', createRequest());
    await controller.getGraphSummary('run-1', createAdminRequest());

    expect(service.getRun).toHaveBeenCalledWith('run-1', expect.any(Object));
    expect(service.cancelRun).toHaveBeenCalledWith('run-1', expect.any(Object));
    expect(service.retryRun).toHaveBeenCalledWith('run-1', expect.any(Object));
    expect(service.getReport).toHaveBeenCalledWith('run-1', expect.any(Object));
    expect(service.getGraphSummary).toHaveBeenCalledWith('run-1', expect.any(Object));
  });

  it('dispatches admin list and admin retry requests', async () => {
    const { controller, service } = createControllerContext();
    service.listRuns.mockResolvedValue(createPaginatedResult([]));
    service.retryRun.mockResolvedValue(createRunResponse({ run_id: 'run-2' }));

    await controller.adminListRuns({ page: 1, per_page: 20, sort: '-created_at' }, createAdminRequest());
    await controller.adminRetryRun('run-1', createAdminRequest());

    expect(service.listRuns).toHaveBeenCalledWith(
      { page: 1, per_page: 20, sort: '-created_at' },
      expect.objectContaining({ actorRole: 'admin' }),
    );
    expect(service.retryRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ actorRole: 'admin' }));
  });

  it.each([
    {
      method: 'createRun' as const,
      code: ErrorCode.GRAPHIFY_RUN_IN_PROGRESS,
      invoke: (controller: GraphifyController) =>
        controller.createRun(TEST_SPACE_ID, { mode: 'full', trigger_type: 'manual' }, createRequest()),
    },
    {
      method: 'getRun' as const,
      code: ErrorCode.GRAPHIFY_RUN_NOT_FOUND,
      invoke: (controller: GraphifyController) => controller.getRun('missing', createRequest()),
    },
    {
      method: 'cancelRun' as const,
      code: ErrorCode.GRAPHIFY_RUN_NOT_CANCELLABLE,
      invoke: (controller: GraphifyController) => controller.cancelRun('run-1', createRequest()),
    },
    {
      method: 'retryRun' as const,
      code: ErrorCode.GRAPHIFY_RUN_NOT_RETRYABLE,
      invoke: (controller: GraphifyController) => controller.retryRun('run-1', createRequest()),
    },
    {
      method: 'getGraphSummary' as const,
      code: ErrorCode.PERMISSION_DENIED,
      invoke: (controller: GraphifyController) => controller.getGraphSummary('run-1', createRequest()),
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
      await controller.getRun('run-1', {});
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
  controller: GraphifyController;
  service: {
    createRun: ReturnType<typeof vi.fn<GraphifyService['createRun']>>;
    listRuns: ReturnType<typeof vi.fn<GraphifyService['listRuns']>>;
    getRun: ReturnType<typeof vi.fn<GraphifyService['getRun']>>;
    cancelRun: ReturnType<typeof vi.fn<GraphifyService['cancelRun']>>;
    retryRun: ReturnType<typeof vi.fn<GraphifyService['retryRun']>>;
    getReport: ReturnType<typeof vi.fn<GraphifyService['getReport']>>;
    getGraphSummary: ReturnType<typeof vi.fn<GraphifyService['getGraphSummary']>>;
  };
} {
  const service = {
    createRun: vi.fn<GraphifyService['createRun']>(),
    listRuns: vi.fn<GraphifyService['listRuns']>(),
    getRun: vi.fn<GraphifyService['getRun']>(),
    cancelRun: vi.fn<GraphifyService['cancelRun']>(),
    retryRun: vi.fn<GraphifyService['retryRun']>(),
    getReport: vi.fn<GraphifyService['getReport']>(),
    getGraphSummary: vi.fn<GraphifyService['getGraphSummary']>(),
  };

  return {
    controller: new GraphifyController(service as unknown as GraphifyService),
    service,
  };
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
  ip: string;
  headers: Record<string, string>;
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
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'vitest',
      'x-request-id': 'req-1',
    },
  };
}

function createAdminRequest(): ReturnType<typeof createRequest> {
  return createRequest('admin');
}

function createRunResponse(
  overrides: Partial<Awaited<ReturnType<GraphifyService['getRun']>>> = {},
): Awaited<ReturnType<GraphifyService['getRun']>> {
  return {
    run_id: 'run-1',
    space_id: TEST_SPACE_ID,
    mode: 'full',
    trigger_type: 'manual',
    status: 'pending',
    progress: { percent: 0, stage: 'pending' },
    input_scope: { page_ids: [], source_document_ids: [] },
    result: {
      nodes_created: 0,
      nodes_updated: 0,
      edges_created: 0,
      wiki_pages_generated: 0,
      schema_version: 'v1',
      graph_json_uri: null,
      report_uri: null,
    },
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

function createPaginatedResult<T>(data: T[]): PaginatedResponse<T> {
  return paginatedResponse(data, buildPaginationMeta(1, 20, data.length));
}

function getMetadata(methodName: keyof GraphifyController): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(GraphifyController.prototype, methodName);
  return Reflect.getMetadata(PERMISSIONS_METADATA_KEY, descriptor?.value as object);
}
