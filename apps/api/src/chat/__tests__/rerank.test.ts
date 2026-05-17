import 'reflect-metadata';

import type {
  ChatProvider,
  ChatProviderConfig,
  EmbeddingProvider,
  EmbeddingProviderConfig,
} from '@cherrygraph/ai-core';
import { indexSnapshots, model_configs, spaces } from '@cherrygraph/shared';
import type { RetrievalResult } from '@cherrygraph/rag-core';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import type { AuditService } from '../../audit/audit.service.js';
import { validateAdminOutboundProbeUrl } from '../../common/outbound-probe-safety.js';
import { TEST_GROUP_ID, TEST_SPACE_ID, TEST_TENANT_ID, TEST_USER_ID } from '../../users/__tests__/user-group-service-test-utils.js';
import { ChatService } from '../chat.service.js';
import type { RerankModelConfig } from '../../models/model-config.service.js';

vi.mock('../../common/outbound-probe-safety.js', () => ({
  validateAdminOutboundProbeUrl: vi.fn(),
}));

type ModelConfigRow = typeof model_configs.$inferSelect;
type SpaceRow = typeof spaces.$inferSelect;
type IndexSnapshotRow = typeof indexSnapshots.$inferSelect;

const originalFetch = globalThis.fetch;
const validateAdminOutboundProbeUrlMock = vi.mocked(validateAdminOutboundProbeUrl);

let validatedDispatcher: { close: ReturnType<typeof vi.fn<() => Promise<void>>> };

beforeEach(() => {
  vi.clearAllMocks();
  validatedDispatcher = mockOutboundProbeValidation();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TEST_RERANK_API_KEY;
  Object.defineProperty(globalThis, 'fetch', {
    value: originalFetch,
    writable: true,
    configurable: true,
  });
});

describe('ChatService static RAG rerank', () => {
  it('reorders retrieval results on successful rerank response', async () => {
    process.env.TEST_RERANK_API_KEY = 'rerank-secret';
    const fetchMock = mockFetchResponse({
      ok: true,
      status: 200,
      body: {
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.5 },
        ],
      },
    });
    const { service, modelConfigService } = createServiceContext({
      rerankConfig: createRerankModelConfig(),
    });
    const retrieveContext = bindRetrieveContext(service);

    const context = await retrieveContext(createPreparedCompletion(), [createSnapshotRow()]);

    expect(context.results.map((result) => result.chunkId)).toEqual(['chunk-b', 'chunk-a']);
    expect(context.trace.finalContext.rerank_status).toBe('success');
    expect(context.trace.finalContext.rerank_model_id).toBe('rerank-config');
    expect(context.trace.finalContext.rerank_latency_ms).toBeGreaterThanOrEqual(1);
    expect(modelConfigService.getEnabledRerankModel).toHaveBeenCalledWith(TEST_TENANT_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://rerank.example/v1/rerank',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer rerank-secret',
          'Content-Type': 'application/json',
        }) as unknown,
        body: JSON.stringify({
          model: 'bge-reranker',
          query: 'How is SSO configured?',
          documents: ['First chunk', 'Second chunk'],
          top_n: 2,
        }),
        dispatcher: validatedDispatcher,
      }),
    );
    expect(validateAdminOutboundProbeUrlMock).toHaveBeenCalledWith('https://rerank.example/v1', { dnsTimeoutMs: 2000 });
    expect(validatedDispatcher.close).toHaveBeenCalledTimes(1);
  });

  it('keeps RRF order when no rerank model is enabled', async () => {
    const fetchMock = mockFetchResponse({
      ok: true,
      status: 200,
      body: { results: [] },
    });
    const { service } = createServiceContext({ rerankConfig: null });
    const retrieveContext = bindRetrieveContext(service);

    const context = await retrieveContext(createPreparedCompletion(), [createSnapshotRow()]);

    expect(context.results.map((result) => result.chunkId)).toEqual(['chunk-a', 'chunk-b']);
    expect(context.trace.finalContext.rerank_status).toBe('skipped');
    expect(context.trace.finalContext.rerank_skip_reason).toBe('no_rerank_model');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(validateAdminOutboundProbeUrlMock).not.toHaveBeenCalled();
  });

  it('keeps RRF order and records timeout when rerank request aborts', async () => {
    process.env.TEST_RERANK_API_KEY = 'rerank-secret';
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const fetchMock = vi.fn(() => Promise.reject(abortError));
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      writable: true,
      configurable: true,
    });
    const { service } = createServiceContext({ rerankConfig: createRerankModelConfig() });
    const retrieveContext = bindRetrieveContext(service);

    const context = await retrieveContext(createPreparedCompletion(), [createSnapshotRow()]);

    expect(context.results.map((result) => result.chunkId)).toEqual(['chunk-a', 'chunk-b']);
    expect(context.trace.finalContext.rerank_status).toBe('timeout');
    expect(context.trace.finalContext.rerank_model_id).toBe('rerank-config');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(validatedDispatcher.close).toHaveBeenCalledTimes(1);
  });

  it('keeps RRF order and records error when rerank API fails', async () => {
    process.env.TEST_RERANK_API_KEY = 'rerank-secret';
    mockFetchResponse({
      ok: false,
      status: 500,
      body: { error: 'failed' },
    });
    const { service } = createServiceContext({ rerankConfig: createRerankModelConfig() });
    const retrieveContext = bindRetrieveContext(service);

    const context = await retrieveContext(createPreparedCompletion(), [createSnapshotRow()]);

    expect(context.results.map((result) => result.chunkId)).toEqual(['chunk-a', 'chunk-b']);
    expect(context.trace.finalContext.rerank_status).toBe('error');
    expect(context.trace.finalContext.rerank_model_id).toBe('rerank-config');
    expect(validatedDispatcher.close).toHaveBeenCalledTimes(1);
  });

  it('skips rerank without calling fetch when retrieval results are empty', async () => {
    const fetchMock = mockFetchResponse({
      ok: true,
      status: 200,
      body: { results: [] },
    });
    const { service, db } = createServiceContext({
      rerankConfig: createRerankModelConfig(),
      vectorRows: [],
      bm25Rows: [],
    });
    const retrieveContext = bindRetrieveContext(service);

    const context = await retrieveContext(createPreparedCompletion(), [createSnapshotRow()]);

    expect(context.results).toEqual([]);
    expect(context.trace.finalContext.rerank_status).toBe('skipped');
    expect(context.trace.finalContext.rerank_skip_reason).toBe('empty_results');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(validateAdminOutboundProbeUrlMock).not.toHaveBeenCalled();
    expect(db.selects).toHaveLength(1);
  });
});

function mockOutboundProbeValidation(rawUrl = 'https://rerank.example/v1'): { close: ReturnType<typeof vi.fn<() => Promise<void>>> } {
  const dispatcher = {
    close: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  };
  validateAdminOutboundProbeUrlMock.mockResolvedValue({
    ok: true,
    url: new URL(rawUrl),
    dispatcher: dispatcher as unknown as NonNullable<RequestInit['dispatcher']> & { close: () => Promise<void> },
  });

  return dispatcher;
}

function createServiceContext(options: {
  rerankConfig: RerankModelConfig | null;
  vectorRows?: unknown[];
  bm25Rows?: unknown[];
}): {
  service: ChatService;
  db: ScriptedRerankDb;
  modelConfigService: {
    getEnabledRerankModel: ReturnType<typeof vi.fn<(tenantId: string) => Promise<RerankModelConfig | null>>>;
    resolveApiKey: ReturnType<typeof vi.fn<(encryptedApiKeyRef: string | null) => string>>;
  };
} {
  const db = new ScriptedRerankDb([
    [createModelRow({ id: 'embedding-model', model_type: 'embedding' })],
  ], [
    { rows: options.vectorRows ?? [createSearchRow({ id: 'chunk-a', content: 'First chunk', score: 0.95 })] },
    { rows: options.bm25Rows ?? [createSearchRow({ id: 'chunk-b', content: 'Second chunk', score: 0.9 })] },
  ]);
  const modelConfigService = {
    getEnabledRerankModel: vi.fn<(tenantId: string) => Promise<RerankModelConfig | null>>(() =>
      Promise.resolve(options.rerankConfig),
    ),
    resolveApiKey: vi.fn((encryptedApiKeyRef: string | null) => {
      expect(encryptedApiKeyRef).toBe('secret:TEST_RERANK_API_KEY');
      return process.env.TEST_RERANK_API_KEY ?? '';
    }),
  };
  const service = new ChatService(
    db.asDrizzle(),
    { push: vi.fn() } as unknown as AuditService,
    vi.fn((_cfg: ChatProviderConfig) => new UnusedChatProvider()),
    vi.fn((_cfg: EmbeddingProviderConfig) => new ScriptedEmbeddingProvider()),
    undefined,
    undefined,
    modelConfigService as never,
  );

  return { service, db, modelConfigService };
}

function bindRetrieveContext(service: ChatService): (
  prepared: PreparedCompletionForRerankTest,
  snapshots: Array<{ spaceId: string; snapshot: IndexSnapshotRow }>,
) => Promise<RetrievedContextForRerankTest> {
  return (service as unknown as {
    retrieveContext: (
      prepared: PreparedCompletionForRerankTest,
      snapshots: Array<{ spaceId: string; snapshot: IndexSnapshotRow }>,
      retrievalMode?: string,
    ) => Promise<RetrievedContextForRerankTest>;
  }).retrieveContext.bind(service);
}

class ScriptedRerankDb {
  readonly selects: unknown[] = [];

  constructor(
    private readonly selectResults: unknown[][],
    private readonly executeResults: Array<{ rows: unknown[] }>,
  ) {}

  asDrizzle(): never {
    return this as never;
  }

  select(): ScriptedSelectBuilder {
    this.selects.push(undefined);
    return new ScriptedSelectBuilder(this.selectResults.shift() ?? []);
  }

  execute(): Promise<{ rows: unknown[] }> {
    return Promise.resolve(this.executeResults.shift() ?? { rows: [] });
  }
}

class ScriptedSelectBuilder implements PromiseLike<unknown[]> {
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

class ScriptedEmbeddingProvider implements EmbeddingProvider {
  getModelId(): string {
    return 'text-embedding-test';
  }

  embedBatch(): Promise<number[][]> {
    return Promise.resolve([[0.1, 0.2, 0.3]]);
  }
}

class UnusedChatProvider implements ChatProvider {
  async *streamCompletion(): AsyncIterable<never> {
    throw new Error('chat provider should not be used');
  }
}

function mockFetchResponse(input: {
  ok: boolean;
  status: number;
  body: unknown;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: input.ok,
      status: input.status,
      json: () => Promise.resolve(input.body),
      body: {
        cancel: () => Promise.resolve(),
      },
    }),
  );
  Object.defineProperty(globalThis, 'fetch', {
    value: fetchMock,
    writable: true,
    configurable: true,
  });

  return fetchMock;
}

type PreparedCompletionForRerankTest = {
  tenantId: string;
  space: SpaceRow;
  spaces: SpaceRow[];
  spaceIds: string[];
  session: {
    id: string;
    tenant_id: string;
    space_id: string;
    user_id: string;
    title: string | null;
    created_at: Date;
    updated_at: Date;
  };
  userId: string;
  userGroupIds: string[];
  message: string;
  chatModel: ModelConfigRow;
  history: [];
  auditContext: Record<string, never>;
};

type RetrievedContextForRerankTest = {
  results: RetrievalResult[];
  trace: {
    finalContext: {
      rerank_status?: string;
      rerank_model_id?: string;
      rerank_latency_ms?: number;
      rerank_skip_reason?: string;
    };
  };
};

function createPreparedCompletion(): PreparedCompletionForRerankTest {
  const space = createSpaceRow();

  return {
    tenantId: TEST_TENANT_ID,
    space,
    spaces: [space],
    spaceIds: [space.id],
    session: {
      id: 'session-1',
      tenant_id: TEST_TENANT_ID,
      space_id: TEST_SPACE_ID,
      user_id: TEST_USER_ID,
      title: null,
      created_at: new Date('2026-05-01T00:00:00.000Z'),
      updated_at: new Date('2026-05-01T00:00:00.000Z'),
    },
    userId: TEST_USER_ID,
    userGroupIds: [TEST_GROUP_ID],
    message: 'How is SSO configured?',
    chatModel: createModelRow({ model_type: 'chat' }),
    history: [],
    auditContext: {},
  };
}

function createSpaceRow(overrides: Partial<SpaceRow> = {}): SpaceRow {
  return {
    id: TEST_SPACE_ID,
    tenant_id: TEST_TENANT_ID,
    name: 'Knowledge',
    slug: 'knowledge',
    description: null,
    status: 'active',
    docmost_space_id: null,
    wiki_repo_path: '/data/wiki/space-1',
    active_graphify_run_id: null,
    active_index_snapshot_id: null,
    index_consistency_status: 'healthy',
    permission_version: 1,
    strict_knowledge_only: true,
    graphify_config: {},
    database_config: { enabled: false },
    default_publish_policy: 'editor_publish',
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createModelRow(overrides: Partial<ModelConfigRow> = {}): ModelConfigRow {
  return {
    id: 'chat-model',
    tenant_id: TEST_TENANT_ID,
    provider: 'openai',
    model_id: 'gpt-test',
    model_type: 'chat',
    display_name: null,
    base_url: null,
    encrypted_api_key_ref: 'secret:TEST_API_KEY',
    embedding_dim: null,
    max_tokens: 4096,
    rate_limit_rpm: null,
    enabled: true,
    visible_group_ids: [],
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createRerankModelConfig(overrides: Partial<RerankModelConfig> = {}): RerankModelConfig {
  return {
    id: 'rerank-config',
    model_id: 'bge-reranker',
    base_url: 'https://rerank.example/v1',
    encrypted_api_key_ref: 'secret:TEST_RERANK_API_KEY',
    ...overrides,
  };
}

function createSnapshotRow(overrides: Partial<IndexSnapshotRow> = {}): { spaceId: string; snapshot: IndexSnapshotRow } {
  return {
    spaceId: TEST_SPACE_ID,
    snapshot: {
      id: 'snapshot-1',
      tenant_id: TEST_TENANT_ID,
      space_id: TEST_SPACE_ID,
      graphify_run_id: null,
      wiki_repo_commit_hash: 'commit',
      embedding_model_id: 'embedding-model',
      chunk_count: 2,
      node_count: 0,
      edge_count: 0,
      status: 'activated',
      created_at: new Date('2026-05-01T00:00:00.000Z'),
      activated_at: new Date('2026-05-01T00:00:00.000Z'),
      ...overrides,
    },
  };
}

function createSearchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'chunk-a',
    content: 'First chunk',
    wiki_page_pk: 'wiki-page-1',
    page_id: 'page-1',
    section_id: 'section-1',
    source_chain_json: {
      source_document_ids: [],
      graph_node_ids: [],
      graph_edge_ids: [],
      edge_confidences: [],
      chain_confidence: 1,
    },
    injection_risk: false,
    page_title: 'Auth',
    section_title: 'SSO',
    score: 0.9,
    ...overrides,
  };
}
