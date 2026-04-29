import 'reflect-metadata';

import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { RequestContext } from '@cherrygraph/shared';
import { lastValueFrom, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestContextStorage } from '../../common/middleware/request-context.middleware.js';
import { Audited } from '../audit.decorator.js';
import { AuditInterceptor } from '../audit.interceptor.js';
import { AuditService, type AuditEntry } from '../audit.service.js';

class AuthController {
  @Audited('auth.login')
  login(this: void): void {
    return undefined;
  }

  notAudited(this: void): void {
    return undefined;
  }
}

describe('AuditInterceptor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pushes an audit entry after a successful handler marked with @Audited('auth.login')", async () => {
    const { interceptor, push } = createInterceptor();

    await requestContextStorage.run(createRequestContext(), async () => {
      await lastValueFrom(interceptor.intercept(createContext(AuthController.prototype.login), createNext()));
    });

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        actor_user_id: 'user-1',
        action: 'auth.login',
        resource_type: 'auth',
      }),
    );
  });

  it('does not push an audit entry for handlers without @Audited()', async () => {
    const { interceptor, push } = createInterceptor();

    await requestContextStorage.run(createRequestContext(), async () => {
      await lastValueFrom(interceptor.intercept(createContext(AuthController.prototype.notAudited), createNext()));
    });

    expect(push).not.toHaveBeenCalled();
  });

  it('includes ip, user_agent, and request_id from request context', async () => {
    const { interceptor, push } = createInterceptor();

    await requestContextStorage.run(createRequestContext({ request_id: 'req-interceptor-123' }), async () => {
      await lastValueFrom(
        interceptor.intercept(
          createContext(AuthController.prototype.login, {
            ip: '198.51.100.7',
            headers: { 'user-agent': 'Vitest Agent' },
          }),
          createNext(),
        ),
      );
    });

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        ip: '198.51.100.7',
        user_agent: 'Vitest Agent',
        request_id: 'req-interceptor-123',
      }),
    );
  });

  it('does not audit failed handler responses', async () => {
    const { interceptor, push } = createInterceptor();
    const error = new Error('handler failed');

    await requestContextStorage.run(createRequestContext(), async () => {
      await expect(
        lastValueFrom(interceptor.intercept(createContext(AuthController.prototype.login), createNextError(error))),
      ).rejects.toThrow(error);
    });

    expect(push).not.toHaveBeenCalled();
  });
});

type RequestOverrides = {
  headers?: Record<string, string>;
  ip?: string;
};

function createInterceptor(): {
  interceptor: AuditInterceptor;
  push: ReturnType<typeof vi.fn<(entry: AuditEntry) => void>>;
} {
  const push = vi.fn<(entry: AuditEntry) => void>();
  const auditService = { push } as unknown as AuditService;
  return {
    interceptor: new AuditInterceptor(auditService),
    push,
  };
}

function createContext(handler: () => void, requestOverrides: RequestOverrides = {}): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => AuthController,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: requestOverrides.headers ?? { 'user-agent': 'Vitest' },
        ip: requestOverrides.ip ?? '203.0.113.10',
      }),
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function createNext(): CallHandler {
  return {
    handle: () => of({ ok: true }),
  };
}

function createNextError(error: Error): CallHandler {
  return {
    handle: () => throwError(() => error),
  };
}

function createRequestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    request_id: 'req-default',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    space_id: null,
    ...overrides,
  };
}
