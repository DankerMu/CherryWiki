import { ErrorCode, model_configs } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUDIT_EVENTS } from '../../audit/audit-events.js';
import { ModelConfigService } from '../model-config.service.js';
import {
  TEST_ACTOR_ID,
  TEST_GROUP_ID,
  TEST_TENANT_ID,
  ScriptedDb,
  createAuditMock,
  getHttpExceptionCode,
  getRejectedHttpException,
  requireRecord,
} from '../../users/__tests__/user-group-service-test-utils.js';

type ModelConfigRow = typeof model_configs.$inferSelect;

const TEST_MODEL_ID = 'model-1';
const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'fetch', {
    value: originalFetch,
    writable: true,
    configurable: true,
  });
});

describe('ModelConfigService', () => {
  it('lists models with API field mapping', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([
      createModelConfigRow({
        display_name: 'GPT-4.1',
        enabled: true,
        base_url: 'https://api.openai.com/v1',
        max_tokens: 8192,
        visible_group_ids: [TEST_GROUP_ID],
      }),
      createModelConfigRow({
        id: 'model-2',
        model_id: 'text-embedding-3-large',
        model_type: 'embedding',
        display_name: 'Embedding',
        enabled: false,
        embedding_dim: 3072,
      }),
    ]);
    db.queueSelect([{ total: 2 }]);

    const result = await service.listModels({ page: 1, per_page: 20 }, createContext());

    expect(result.data).toEqual([
      expect.objectContaining({
        id: TEST_MODEL_ID,
        name: 'GPT-4.1',
        provider: 'openai',
        model_id: 'gpt-4.1',
        model_type: 'chat',
        status: 'active',
        config: {
          base_url: 'https://api.openai.com/v1',
          embedding_dim: null,
          max_tokens: 8192,
          rate_limit_rpm: null,
        },
        visible_group_ids: [TEST_GROUP_ID],
      }),
      expect.objectContaining({
        id: 'model-2',
        name: 'Embedding',
        status: 'disabled',
      }),
    ]);
    expect(result.data[1]?.config.embedding_dim).toBe(3072);
    expect(result.pagination.total).toBe(2);
  });

  it('creates a model and records admin.model.create', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([]);

    const result = await service.createModel(
      {
        provider: ' openai ',
        model_id: 'gpt-4.1',
        model_type: 'chat',
        display_name: 'GPT-4.1',
        base_url: 'https://api.openai.com/v1',
        encrypted_api_key_ref: 'secret:openai_key',
        max_tokens: 8192,
        enabled: true,
        visible_group_ids: [TEST_GROUP_ID],
      },
      createContext(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        name: 'GPT-4.1',
        provider: 'openai',
        model_id: 'gpt-4.1',
        status: 'active',
        visible_group_ids: [TEST_GROUP_ID],
      }),
    );
    expect(requireRecord(db.inserts[0]?.value)).toEqual(
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        provider: 'openai',
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    );
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        actor_user_id: TEST_ACTOR_ID,
        action: AUDIT_EVENTS.ADMIN_MODEL_CREATE,
        resource_type: 'model_config',
      }),
    );
  });

  it('maps duplicate provider and model_id to MODEL_NAME_CONFLICT', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createModelConfigRow()]);

    const err = await getRejectedHttpException(
      service.createModel(
        {
          provider: 'openai',
          model_id: 'gpt-4.1',
          model_type: 'chat',
        },
        createContext(),
      ),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.MODEL_NAME_CONFLICT);
    expect(db.inserts).toHaveLength(0);
  });

  it('rejects creating a second enabled embedding model', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);
    db.queueSelect([{ total: 1 }]);

    const err = await getRejectedHttpException(
      service.createModel(
        {
          provider: 'openai',
          model_id: 'text-embedding-3-large',
          model_type: 'embedding',
          enabled: true,
        },
        createContext(),
      ),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.EMBEDDING_LIMIT_EXCEEDED);
    expect(db.inserts).toHaveLength(0);
  });

  it('updates a model and records admin.model.update', async () => {
    const { service, db, audit } = createServiceContext();
    db.queueSelect([createModelConfigRow({ max_tokens: 8192 })]);
    db.queueUpdate([createModelConfigRow({ max_tokens: 16384 })]);

    const result = await service.updateModel(TEST_MODEL_ID, { max_tokens: 16384 }, createContext());

    expect(result.config.max_tokens).toBe(16384);
    expect(requireRecord(db.updates[0]?.value)).toEqual(expect.objectContaining({ max_tokens: 16384 }));
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_MODEL_UPDATE,
        resource_id: TEST_MODEL_ID,
      }),
    );
  });

  it('returns MODEL_NOT_FOUND when updating a missing model', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.updateModel('missing-model', { enabled: false }, createContext()),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.MODEL_NOT_FOUND);
  });

  it('rejects enabling a second embedding model through update', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([createModelConfigRow({ model_type: 'embedding', enabled: false })]);
    db.queueSelect([{ total: 1 }]);

    const err = await getRejectedHttpException(
      service.updateModel(TEST_MODEL_ID, { enabled: true }, createContext()),
    );

    expect(err.getStatus()).toBe(409);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.EMBEDDING_LIMIT_EXCEEDED);
    expect(db.updates).toHaveLength(0);
  });

  it('tests chat model connectivity with valid URL and key', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: 'secret:openai_key' })]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const result = await service.testConnectivity(
        TEST_MODEL_ID,
        { test_prompt: 'Hello' },
        createContext(),
      );

      expect(result.reachable).toBe(true);
      expect(result.latency_ms).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    });
    const { url, init } = getFirstFetchCall(fetchMock);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    });
    expect(init.body).toBe(
      JSON.stringify({
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    );
  });

  it('returns unreachable when chat model fetch hits a network error', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchError(new TypeError('network error'));
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: 'secret:openai_key' })]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      expect(result.reachable).toBe(false);
      expect(result.error).toContain('network error');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns authentication failure when chat model probe returns 401', async () => {
    const { service, db } = createServiceContext();
    mockFetchResponse(401);
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: 'secret:openai_key' })]);

    await withEnv('OPENAI_KEY', 'invalid-key', async () => {
      const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      expect(result).toEqual(
        expect.objectContaining({
          reachable: false,
          error: 'Authentication failed (HTTP 401)',
        }),
      );
    });
  });

  it('tests embedding model connectivity through the embeddings endpoint', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    db.queueSelect([
      createModelConfigRow({
        model_id: 'text-embedding-3-large',
        model_type: 'embedding',
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    ]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      expect(result.reachable).toBe(true);
      expect(result.error).toBeUndefined();
    });
    const { url, init } = getFirstFetchCall(fetchMock);
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ model: 'text-embedding-3-large', input: 'test' }));
  });

  it('tests rerank model connectivity through the rerank endpoint', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    db.queueSelect([
      createModelConfigRow({
        model_id: 'bge-reranker-large',
        model_type: 'rerank',
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    ]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      expect(result.reachable).toBe(true);
      expect(result.error).toBeUndefined();
    });
    const { url, init } = getFirstFetchCall(fetchMock);
    expect(url).toBe('https://api.openai.com/v1/rerank');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ model: 'bge-reranker-large', query: 'test', documents: ['test'] }));
  });

  it('returns unreachable when rerank probe returns 500', async () => {
    const { service, db } = createServiceContext();
    mockFetchResponse(500);
    db.queueSelect([
      createModelConfigRow({
        model_type: 'rerank',
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    ]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      expect(result).toEqual(
        expect.objectContaining({
          reachable: false,
          error: 'HTTP 500',
        }),
      );
    });
  });

  it('falls back to MODEL_API_BASE_URL when model base_url is absent', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    db.queueSelect([
      createModelConfigRow({
        base_url: null,
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    ]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      await withEnv('MODEL_API_BASE_URL', 'https://fallback.example.com/v1', async () => {
        const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

        expect(result.reachable).toBe(true);
      });
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://fallback.example.com/v1/chat/completions');
  });

  it('returns no base URL configured without fetching when model and env URL are absent', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    db.queueSelect([
      createModelConfigRow({
        base_url: null,
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    ]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      await withEnv('MODEL_API_BASE_URL', undefined, async () => {
        const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

        expect(result).toEqual(
          expect.objectContaining({
            reachable: false,
            error: 'No base URL configured',
          }),
        );
      });
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns no API key configured without fetching when key ref is null', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: null })]);

    const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

    expect(result).toEqual(
      expect.objectContaining({
        reachable: false,
        error: 'No API key configured',
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns no API key configured without fetching when key ref is empty string', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: '' })]);

    const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

    expect(result).toEqual(
      expect.objectContaining({
        reachable: false,
        error: 'No API key configured',
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns timeout-specific error when probe aborts after 10 seconds', async () => {
    vi.useFakeTimers();
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchTimeout();
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: 'secret:openai_key' })]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const resultPromise = service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      await vi.advanceTimersByTimeAsync(10000);
      const result = await resultPromise;

      expect(result.reachable).toBe(false);
      expect(result.latency_ms).toBe(10000);
      expect(result.error).toContain('timed out');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns MODEL_NOT_FOUND when connectivity test target is missing', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.testConnectivity('missing-model', {}, createContext()),
    );

    expect(err.getStatus()).toBe(404);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.MODEL_NOT_FOUND);
  });

  it('records admin.model.test audit with reachable=true for successful connectivity tests', async () => {
    const { service, db, audit } = createServiceContext();
    mockFetchResponse(200);
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: 'secret:openai_key' })]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      await service.testConnectivity(TEST_MODEL_ID, {}, createContext());
    });

    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.ADMIN_MODEL_TEST,
        tenant_id: TEST_TENANT_ID,
        actor_user_id: TEST_ACTOR_ID,
        resource_type: 'model_config',
        resource_id: TEST_MODEL_ID,
      }),
    );
    expect(findAuditMetadata(audit, AUDIT_EVENTS.ADMIN_MODEL_TEST, TEST_MODEL_ID)).toMatchObject({
      model_id: 'gpt-4.1',
      reachable: true,
    });
  });

  it('records admin.model.test audit with reachable=false and error for failed tests', async () => {
    const { service, db, audit } = createServiceContext();
    mockFetchError(new TypeError('network error'));
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: 'secret:openai_key' })]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      await service.testConnectivity(TEST_MODEL_ID, {}, createContext());
    });

    expect(findAuditMetadata(audit, AUDIT_EVENTS.ADMIN_MODEL_TEST, TEST_MODEL_ID)).toMatchObject({
      model_id: 'gpt-4.1',
      reachable: false,
      error: 'network error',
    });
  });
});

type FetchMock = ReturnType<typeof vi.fn<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>>;

function mockFetchResponse(status: number): FetchMock {
  const fetchMock = vi.fn<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>(() =>
    Promise.resolve(new Response(null, { status })),
  );
  setFetchMock(fetchMock);
  return fetchMock;
}

function mockFetchError(error: Error): FetchMock {
  const fetchMock = vi.fn<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>(() =>
    Promise.reject(error),
  );
  setFetchMock(fetchMock);
  return fetchMock;
}

function mockFetchTimeout(): FetchMock {
  const fetchMock = vi.fn<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
  );
  setFetchMock(fetchMock);
  return fetchMock;
}

function setFetchMock(fetchMock: FetchMock): void {
  Object.defineProperty(globalThis, 'fetch', {
    value: fetchMock,
    writable: true,
    configurable: true,
  });
}

function getFirstFetchCall(fetchMock: FetchMock): { url: string; init: RequestInit } {
  const firstCall = fetchMock.mock.calls[0];
  if (firstCall === undefined) {
    throw new Error('Expected fetch to be called');
  }

  const [input, init] = firstCall;
  return { url: fetchInputToUrl(input), init: init ?? {} };
}

function fetchInputToUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function createServiceContext(): {
  service: ModelConfigService;
  db: ScriptedDb;
  audit: ReturnType<typeof createAuditMock>;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  const service = new ModelConfigService(db.asDrizzle(), audit.service);

  return { service, db, audit };
}

function createContext(
  overrides: Partial<{ tenantId: string; actorUserId: string }> = {},
): { tenantId: string; actorUserId: string } {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_ACTOR_ID,
    ...overrides,
  };
}

function createModelConfigRow(overrides: Partial<ModelConfigRow> = {}): ModelConfigRow {
  return {
    id: TEST_MODEL_ID,
    tenant_id: TEST_TENANT_ID,
    provider: 'openai',
    model_id: 'gpt-4.1',
    model_type: 'chat',
    display_name: 'GPT-4.1',
    base_url: 'https://api.openai.com/v1',
    encrypted_api_key_ref: 'secret:openai_key',
    embedding_dim: null,
    max_tokens: null,
    rate_limit_rpm: null,
    enabled: true,
    visible_group_ids: [],
    created_at: new Date('2026-04-04T00:00:00.000Z'),
    updated_at: new Date('2026-04-04T00:00:00.000Z'),
    ...overrides,
  };
}

function findAuditMetadata(
  audit: ReturnType<typeof createAuditMock>,
  action: string,
  resourceId: string,
): Record<string, unknown> | undefined {
  const entry = audit.push.mock.calls
    .map(([auditEntry]) => auditEntry)
    .find((auditEntry) => auditEntry.action === action && auditEntry.resource_id === resourceId);
  return entry?.metadata_json;
}

async function withEnv(name: string, value: string | undefined, callback: () => Promise<void>): Promise<void> {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    await callback();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}
