import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getApiLogger } from '../../common/logger/logger.module.js';
import { BridgeModule } from '../bridge.module.js';
import { DocmostBootstrapService } from '../docmost-bootstrap.service.js';

const originalEnv = {
  DOCMOST_BASE_URL: process.env.DOCMOST_BASE_URL,
  DOCMOST_BRIDGE_SECRET: process.env.DOCMOST_BRIDGE_SECRET,
  DOCMOST_ADMIN_EMAIL: process.env.DOCMOST_ADMIN_EMAIL,
  DOCMOST_ADMIN_PASSWORD: process.env.DOCMOST_ADMIN_PASSWORD,
  CHERRY_TENANT_NAME: process.env.CHERRY_TENANT_NAME,
};

describe('DocmostBootstrapService', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    getApiLogger().level = 'silent';
    setBootstrapEnv();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv();
  });

  it('calls the bootstrap endpoint when workspace_initialized is false', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ workspace_initialized: false }))
      .mockResolvedValueOnce(jsonResponse({ workspace_id: 'workspace-1', user_id: 'user-1' }));
    const service = new DocmostBootstrapService();

    await expect(service.bootstrapIfNeeded()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchCall(fetchMock, 0)[0]).toBe(
      'https://docmost.example.com/api/internal/bridge/health',
    );
    expect(fetchCall(fetchMock, 1)[0]).toBe(
      'https://docmost.example.com/api/internal/bridge/bootstrap',
    );
    const bootstrapInit = fetchCall(fetchMock, 1)[1] as RequestInit;
    expect(bootstrapInit.method).toBe('POST');
    if (typeof bootstrapInit.body !== 'string') {
      throw new Error('Expected JSON bootstrap request body');
    }
    expect(JSON.parse(bootstrapInit.body)).toEqual({
      workspaceName: 'CherryWiki',
      name: 'Admin',
      email: 'admin@cherrywiki.local',
      password: 'changeme-initial-setup',
    });
  });

  it('skips bootstrap when workspace_initialized is true', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ workspace_initialized: true }));
    const service = new DocmostBootstrapService();

    await expect(service.bootstrapIfNeeded()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchCall(fetchMock, 0)[0]).toBe(
      'https://docmost.example.com/api/internal/bridge/health',
    );
  });

  it("logs warn and doesn't throw when Docmost is unreachable", async () => {
    const warn = vi.spyOn(getApiLogger(), 'warn').mockImplementation(() => undefined);
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const service = new DocmostBootstrapService();

    await expect(service.bootstrapIfNeeded()).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith(
      { err: 'connection refused' },
      'Docmost workspace bootstrap skipped',
    );
  });
});

describe('BridgeModule Docmost bootstrap lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls bootstrapIfNeeded and catches errors', async () => {
    const bootstrapIfNeeded = vi.fn().mockRejectedValue(new Error('boom'));
    const service = { bootstrapIfNeeded } as Pick<
      DocmostBootstrapService,
      'bootstrapIfNeeded'
    >;
    const module = new BridgeModule(service as DocmostBootstrapService);

    await expect(module.onApplicationBootstrap()).resolves.toBeUndefined();
    module.onModuleDestroy();

    expect(bootstrapIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('retries after the initial bootstrap failure', async () => {
    vi.useFakeTimers();
    const bootstrapIfNeeded = vi.fn().mockResolvedValue(false);
    const service = { bootstrapIfNeeded } as Pick<
      DocmostBootstrapService,
      'bootstrapIfNeeded'
    >;
    const module = new BridgeModule(service as DocmostBootstrapService);

    await module.onApplicationBootstrap();
    expect(bootstrapIfNeeded).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(bootstrapIfNeeded).toHaveBeenCalledTimes(2);
    module.onModuleDestroy();
  });
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(payload),
    body: { cancel: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Response;
}

function fetchCall(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  index: number,
): Parameters<typeof fetch> {
  const call = fetchMock.mock.calls[index];
  if (call === undefined) {
    throw new Error(`Expected fetch call ${index}`);
  }

  return call;
}

function setBootstrapEnv(): void {
  process.env.DOCMOST_BASE_URL = 'https://docmost.example.com/';
  process.env.DOCMOST_BRIDGE_SECRET = 'bridge-secret';
  process.env.DOCMOST_ADMIN_EMAIL = 'admin@cherrywiki.local';
  process.env.DOCMOST_ADMIN_PASSWORD = 'changeme-initial-setup';
  delete process.env.CHERRY_TENANT_NAME;
}

function restoreEnv(): void {
  restoreEnvValue('DOCMOST_BASE_URL', originalEnv.DOCMOST_BASE_URL);
  restoreEnvValue('DOCMOST_BRIDGE_SECRET', originalEnv.DOCMOST_BRIDGE_SECRET);
  restoreEnvValue('DOCMOST_ADMIN_EMAIL', originalEnv.DOCMOST_ADMIN_EMAIL);
  restoreEnvValue('DOCMOST_ADMIN_PASSWORD', originalEnv.DOCMOST_ADMIN_PASSWORD);
  restoreEnvValue('CHERRY_TENANT_NAME', originalEnv.CHERRY_TENANT_NAME);
}

function restoreEnvValue(name: keyof typeof originalEnv, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
