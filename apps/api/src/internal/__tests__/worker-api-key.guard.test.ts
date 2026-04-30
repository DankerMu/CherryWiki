import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getApiLogger } from '../../common/logger/logger.module.js';
import { WorkerApiKeyGuard } from '../worker-api-key.guard.js';

describe('WorkerApiKeyGuard', () => {
  const originalWorkerApiKey = process.env.WORKER_API_KEY;

  afterEach(() => {
    if (originalWorkerApiKey === undefined) {
      delete process.env.WORKER_API_KEY;
    } else {
      process.env.WORKER_API_KEY = originalWorkerApiKey;
    }

    vi.restoreAllMocks();
  });

  it('allows requests with the configured worker key', () => {
    process.env.WORKER_API_KEY = 'secret-worker-key';
    const guard = new WorkerApiKeyGuard();

    expect(guard.canActivate(createContext('secret-worker-key'))).toBe(true);
  });

  it.each([undefined, 'wrong-key'])('rejects requests with missing or invalid keys', (workerKey) => {
    process.env.WORKER_API_KEY = 'secret-worker-key';
    const guard = new WorkerApiKeyGuard();

    expect(() => guard.canActivate(createContext(workerKey))).toThrowError(HttpException);

    try {
      guard.canActivate(createContext(workerKey));
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(401);
    }
  });

  it('warns when WORKER_API_KEY is not configured', () => {
    delete process.env.WORKER_API_KEY;
    const warnSpy = vi.spyOn(getApiLogger(), 'warn').mockImplementation(() => undefined);

    new WorkerApiKeyGuard();

    expect(warnSpy).toHaveBeenCalledWith(
      { worker_api_key_present: false },
      'WORKER_API_KEY is not configured; internal worker endpoints will reject all requests',
    );
  });
});

function createContext(workerKey?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: workerKey === undefined ? {} : { 'x-worker-key': workerKey },
      }),
    }),
  } as unknown as ExecutionContext;
}
