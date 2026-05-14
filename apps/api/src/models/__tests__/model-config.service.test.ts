import { lookup as dnsLookup } from 'node:dns/promises';
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

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])),
}));

type ModelConfigRow = typeof model_configs.$inferSelect;

const TEST_MODEL_ID = 'model-1';
const originalFetch = globalThis.fetch;
const dnsLookupMock = vi.mocked(dnsLookup);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  dnsLookupMock.mockClear();
  setDnsRecords('93.184.216.34');
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
    expect(init.redirect).toBe('manual');
    expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toEqual(expect.any(Object));
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

  it('rejects unsupported model base_url scheme before fetching', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    db.queueSelect([
      createModelConfigRow({
        base_url: 'ftp://model.example.com/v1',
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    ]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      expect(result).toEqual(
        expect.objectContaining({
          reachable: false,
          error: expect.stringMatching(/unsupported URL scheme/i) as unknown,
        }),
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dnsLookupMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported MODEL_API_BASE_URL fallback scheme before fetching', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    db.queueSelect([
      createModelConfigRow({
        base_url: null,
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    ]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      await withEnv('MODEL_API_BASE_URL', 'file:///tmp/model.sock', async () => {
        const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

        expect(result).toEqual(
          expect.objectContaining({
            reachable: false,
            error: expect.stringMatching(/unsupported URL scheme/i) as unknown,
          }),
        );
      });
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dnsLookupMock).not.toHaveBeenCalled();
  });

  it.each([
    ['localhost', 'http://localhost:11434/v1'],
    ['private IPv4', 'http://10.0.0.10:11434/v1'],
    ['link-local metadata IPv4', 'http://169.254.169.254/latest'],
    ['IPv6 localhost', 'http://[::1]:11434/v1'],
    ['IPv6 ULA', 'http://[fd00::1]:11434/v1'],
    ['IPv6 link-local', 'http://[fe80::1]:11434/v1'],
    ['IPv4-mapped private IPv6', 'http://[::ffff:10.0.0.1]:11434/v1'],
  ])('blocks unsafe model target %s before fetching', async (_name, baseUrl) => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    db.queueSelect([
      createModelConfigRow({
        base_url: baseUrl,
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    ]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      await withEnv('ADMIN_OUTBOUND_PROBE_ALLOWLIST', undefined, async () => {
        const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

        expect(result).toEqual(
          expect.objectContaining({
            reachable: false,
            error: expect.stringMatching(/blocked private or local address/i) as unknown,
          }),
        );
      });
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks a model target whose hostname resolves to a private address', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    setDnsRecords('10.1.2.3');
    db.queueSelect([
      createModelConfigRow({
        base_url: 'https://models.internal.example/v1',
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    ]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      expect(result).toEqual(
        expect.objectContaining({
          reachable: false,
          error: expect.stringMatching(/blocked private or local address/i) as unknown,
        }),
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('carries the validated DNS dispatcher into model fetches to prevent a second resolver decision', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    setDnsRecords('93.184.216.34');
    db.queueSelect([
      createModelConfigRow({
        base_url: 'https://rebinding.example/v1',
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    ]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      expect(result.reachable).toBe(true);
    });

    const { init } = getFirstFetchCall(fetchMock);
    expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toEqual(expect.any(Object));
    expect(dnsLookupMock).toHaveBeenCalledTimes(1);
  });

  it('allows an explicitly allowlisted internal model endpoint to use existing probe fetch behavior', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    db.queueSelect([
      createModelConfigRow({
        base_url: 'http://10.0.0.10:11434/v1',
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    ]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      await withEnv('ADMIN_OUTBOUND_PROBE_ALLOWLIST', '10.0.0.0/24', async () => {
        const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

        expect(result.reachable).toBe(true);
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://10.0.0.10:11434/v1/chat/completions');
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('manual');
  });

  it('rejects credential-bearing model probe URLs before fetching', async () => {
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    db.queueSelect([
      createModelConfigRow({
        base_url: 'https://user:pass@api.openai.com/v1',
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    ]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      expect(result).toEqual(
        expect.objectContaining({
          reachable: false,
          error: expect.stringMatching(/URL credentials are not allowed/i) as unknown,
        }),
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dnsLookupMock).not.toHaveBeenCalled();
  });

  it('fails closed when model DNS validation does not resolve within the probe timeout', async () => {
    vi.useFakeTimers();
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchResponse(200);
    dnsLookupMock.mockImplementation(() => new Promise(() => undefined));
    db.queueSelect([
      createModelConfigRow({
        base_url: 'https://slow-dns.example/v1',
        encrypted_api_key_ref: 'secret:openai_key',
      }),
    ]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const resultPromise = service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      await vi.advanceTimersByTimeAsync(10000);
      const result = await resultPromise;

      expect(result).toEqual(
        expect.objectContaining({
          reachable: false,
          latency_ms: 10000,
          error: expect.stringMatching(/DNS resolution timed out/i) as unknown,
        }),
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sanitizes provider error details before returning and auditing model probe failures', async () => {
    const { service, db, audit } = createServiceContext();
    const fetchMock = mockFetchError(
      new TypeError('fetch failed: Authorization: Bearer test-key Cookie: session=secret api_key=sk-secret123'),
    );
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: 'secret:openai_key' })]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      expect(result).toEqual(
        expect.objectContaining({
          reachable: false,
          error: 'Outbound request failed',
        }),
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(findAuditMetadata(audit, AUDIT_EVENTS.ADMIN_MODEL_TEST, TEST_MODEL_ID)).toMatchObject({
      reachable: false,
      error: 'Outbound request failed',
    });
  });

  it('sanitizes bare API keys, token query params, and URL userinfo in model probe errors', async () => {
    const { service, db, audit } = createServiceContext();
    const secretValue = 'sk-live-secret-value-1234567890';
    const fetchMock = mockFetchError(
      new TypeError(
        `fetch failed ${secretValue} https://user:pass@example.com/v1?token=topsecretvalue&client_secret=hidden`,
      ),
    );
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: 'secret:openai_key' })]);

    await withEnv('OPENAI_KEY', secretValue, async () => {
      const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      expect(result).toEqual(
        expect.objectContaining({
          reachable: false,
          error: 'Outbound request failed',
        }),
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(findAuditMetadata(audit, AUDIT_EVENTS.ADMIN_MODEL_TEST, TEST_MODEL_ID)).toMatchObject({
      reachable: false,
      error: 'Outbound request failed',
    });
  });

  it('sanitizes short configured API keys in model probe errors', async () => {
    const { service, db, audit } = createServiceContext();
    const fetchMock = mockFetchError(new TypeError('provider error included key abc'));
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: 'secret:openai_key' })]);

    await withEnv('OPENAI_KEY', 'abc', async () => {
      const result = await service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      expect(result).toEqual(
        expect.objectContaining({
          reachable: false,
          error: 'Outbound request failed',
        }),
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(findAuditMetadata(audit, AUDIT_EVENTS.ADMIN_MODEL_TEST, TEST_MODEL_ID)).toMatchObject({
      reachable: false,
      error: 'Outbound request failed',
    });
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

  it('uses one model probe deadline across slow DNS validation and fetch timeout', async () => {
    vi.useFakeTimers();
    const { service, db } = createServiceContext();
    const fetchMock = mockFetchTimeout();
    dnsLookupMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve([{ address: '93.184.216.34', family: 4 }] as unknown as Awaited<ReturnType<typeof dnsLookup>>);
          }, 9000);
        }),
    );
    db.queueSelect([createModelConfigRow({ encrypted_api_key_ref: 'secret:openai_key' })]);

    await withEnv('OPENAI_KEY', 'test-key', async () => {
      const resultPromise = service.testConnectivity(TEST_MODEL_ID, {}, createContext());

      await vi.advanceTimersByTimeAsync(9000);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(result.reachable).toBe(false);
      expect(result.latency_ms).toBe(10000);
      expect(result.error).toBe('Request timed out (10s total)');
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

function setDnsRecords(...addresses: string[]): void {
  dnsLookupMock.mockResolvedValue(
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })) as unknown as Awaited<
      ReturnType<typeof dnsLookup>
    >,
  );
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
