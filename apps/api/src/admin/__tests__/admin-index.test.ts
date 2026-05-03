import 'reflect-metadata';

import { HttpException, HttpStatus, type ExecutionContext } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import {
  JobRepository,
  QueueFactory,
  QUEUE_INDEXING,
  type JobRow,
} from '@cherrygraph/job-core';
import { PERMISSIONS_METADATA_KEY, RbacGuard } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditEntry, AuditService } from '../../audit/audit.service.js';
import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { AdminIndexController } from '../admin-index.controller.js';
import { AdminIndexService } from '../admin-index.service.js';

describe('AdminIndexController', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies admin permissions and 202 response metadata', () => {
    expect(getMetadata('rebuildIndex')).toEqual(['admin']);
    expect(getHttpCode('rebuildIndex')).toBe(HttpStatus.ACCEPTED);
  });

  it('creates a full rebuild job by default, enqueues it, and audits', async () => {
    const { controller, db, audit } = createControllerContext();
    const queue = createQueueMock();
    const job = createJobRow({ id: 'job-full' });
    db.queueSelect([{ id: TEST_SPACE_ID }]);
    db.queueSelect([]);
    const createJobSpy = vi.spyOn(JobRepository, 'create').mockResolvedValue(job);
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(queue as never);

    const result = await controller.rebuildIndex(TEST_SPACE_ID, {}, undefined, createRequest());

    expect(result).toEqual({ data: job });
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
          trigger: 'manual_rebuild',
          scope: 'full',
        },
        created_by: TEST_USER_ID,
      }),
    );
    expect(queue.add).toHaveBeenCalledWith('reindex', { jobId: 'job-full' });
    expect(queue.close).toHaveBeenCalledTimes(1);
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.index.rebuild',
        resource_type: 'space',
        resource_id: TEST_SPACE_ID,
        space_id: TEST_SPACE_ID,
        request_id: 'req-1',
        metadata_json: {
          reindex_job_id: 'job-full',
          trigger: 'manual_rebuild',
          scope: 'full',
        },
      }) as AuditEntry,
    );
  });

  it('supports incremental rebuild scope and idempotency key job creation', async () => {
    const { controller, db } = createControllerContext();
    const queue = createQueueMock();
    const job = createJobRow({ id: 'job-incremental' });
    db.queueSelect([]);
    db.queueSelect([{ id: TEST_SPACE_ID }]);
    db.queueSelect([]);
    const createJobSpy = vi.spyOn(JobRepository, 'create').mockResolvedValue(job);
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(queue as never);

    const result = await controller.rebuildIndex(
      TEST_SPACE_ID,
      { scope: 'incremental', reason: 'refresh changed pages' },
      'idem-key-1',
      createRequest(),
    );

    expect(result).toEqual({ data: job });
    expect(createJobSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotency_key: 'idem-key-1',
        payload_json: {
          tenant_id: TEST_TENANT_ID,
          space_id: TEST_SPACE_ID,
          trigger: 'manual_rebuild',
          scope: 'incremental',
          reason: 'refresh changed pages',
        },
      }),
    );
  });

  it('RBAC rejects non-admin rebuild requests', async () => {
    const guard = new RbacGuard(new Reflector());

    try {
      await guard.canActivate(createGuardContext('rebuildIndex', createRequest('editor')));
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(403);
      expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
      return;
    }

    throw new Error('Expected RBAC guard to reject non-admin rebuild request');
  });

  it('returns 404 when the space is missing', async () => {
    const { service, db } = createControllerContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.rebuildIndex(TEST_SPACE_ID, {}, createAdminContext()),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.SPACE_NOT_FOUND);
  });

  it('returns 409 when an index rebuild is already running', async () => {
    const { service, db } = createControllerContext();
    db.queueSelect([{ id: TEST_SPACE_ID }]);
    db.queueSelect([{ id: 'snapshot-building' }]);

    const err = await getRejectedHttpException(
      service.rebuildIndex(TEST_SPACE_ID, {}, createAdminContext()),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe('REBUILD_ALREADY_RUNNING');
  });

  it('returns the same idempotent job without creating a duplicate or enqueueing twice', async () => {
    const { controller, db } = createControllerContext();
    const queue = createQueueMock();
    const job = createJobRow({ id: 'job-idempotent', idempotency_key: 'idem-key-1' });
    db.queueSelect([]);
    db.queueSelect([{ id: TEST_SPACE_ID }]);
    db.queueSelect([]);
    db.queueSelect([job]);
    const createJobSpy = vi.spyOn(JobRepository, 'create').mockResolvedValue(job);
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(queue as never);

    const first = await controller.rebuildIndex(TEST_SPACE_ID, {}, 'idem-key-1', createRequest());
    const second = await controller.rebuildIndex(TEST_SPACE_ID, {}, 'idem-key-1', createRequest());

    expect(first).toEqual({ data: job });
    expect(second).toEqual({ data: job });
    expect(createJobSpy).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});

function createControllerContext(): {
  controller: AdminIndexController;
  service: AdminIndexService;
  db: ScriptedAdminDb;
  audit: {
    push: ReturnType<typeof vi.fn<(entry: AuditEntry) => void>>;
  };
} {
  const db = new ScriptedAdminDb();
  const audit = {
    push: vi.fn<(entry: AuditEntry) => void>(),
  };
  const service = new AdminIndexService(db.asDrizzle(), audit as unknown as AuditService, createRedisMock() as never);

  return {
    controller: new AdminIndexController(service),
    service,
    db,
    audit,
  };
}

class ScriptedAdminDb {
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

  where(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function createRequest(role = 'admin'): {
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
      email: 'admin@example.com',
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

function createAdminContext(): {
  tenantId: string;
  actorUserId: string;
} {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_USER_ID,
  };
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

function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-rebuild',
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
      trigger: 'manual_rebuild',
      scope: 'full',
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

function getMetadata(methodName: keyof AdminIndexController): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(AdminIndexController.prototype, methodName);
  return Reflect.getMetadata(PERMISSIONS_METADATA_KEY, descriptor?.value as object);
}

function getHttpCode(methodName: keyof AdminIndexController): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(AdminIndexController.prototype, methodName);
  return Reflect.getMetadata(HTTP_CODE_METADATA, descriptor?.value as object);
}

function createGuardContext(methodName: keyof AdminIndexController, request: unknown): ExecutionContext {
  const descriptor = Object.getOwnPropertyDescriptor(AdminIndexController.prototype, methodName);
  return {
    getHandler: () => descriptor?.value as () => unknown,
    getClass: () => AdminIndexController,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}
