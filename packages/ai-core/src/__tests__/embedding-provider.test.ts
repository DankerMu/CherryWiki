import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenAIEmbeddingProvider, countTokens, getEmbeddingDimension, type EmbeddingProvider } from '../index.js';

const { createMock, openAIConstructorMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  openAIConstructorMock: vi.fn(),
}));

vi.mock('openai', () => ({
  default: openAIConstructorMock.mockImplementation(function OpenAIMock() {
    return {
    embeddings: {
      create: createMock,
    },
    };
  }),
}));

describe('OpenAIEmbeddingProvider', () => {
  beforeEach(() => {
    process.env.TEST_OPENAI_API_KEY = 'test-key';
    createMock.mockReset();
    openAIConstructorMock.mockClear();
  });

  afterEach(() => {
    delete process.env.TEST_OPENAI_API_KEY;
    vi.useRealTimers();
  });

  it('embeds single and batch inputs with expected dimensions', async () => {
    createMock
      .mockResolvedValueOnce(createEmbeddingResponse([[0.1, 0.2, 0.3]]))
      .mockResolvedValueOnce(
        createEmbeddingResponse([
          [0.4, 0.5, 0.6],
          [0.7, 0.8, 0.9],
        ]),
      );

    const provider = createProvider();

    await expect(provider.embedBatch(['one'])).resolves.toEqual([[0.1, 0.2, 0.3]]);
    await expect(provider.embedBatch(['two', 'three'])).resolves.toEqual([
      [0.4, 0.5, 0.6],
      [0.7, 0.8, 0.9],
    ]);
  });

  it('resolves API keys from env vars and fails when missing', async () => {
    createMock.mockResolvedValueOnce(createEmbeddingResponse([[0.1]]));

    const provider = createProvider({ baseUrl: 'https://example.test/v1' });
    await expect(provider.embedBatch(['one'])).resolves.toEqual([[0.1]]);
    expect(openAIConstructorMock).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseURL: 'https://example.test/v1',
    });

    delete process.env.TEST_OPENAI_API_KEY;
    expect(() => createProvider()).toThrow(/TEST_OPENAI_API_KEY/);
  });

  it('splits large inputs into sequential batches and preserves result order', async () => {
    createMock.mockImplementation((params: { input: string[] }) =>
      Promise.resolve(createEmbeddingResponse(params.input.map((text) => [Number(text.split('-')[1])]))),
    );

    const provider = createProvider();
    const texts = Array.from({ length: 5000 }, (_, index) => `text-${index}`);
    const embeddings = await provider.embedBatch(texts);

    expect(createMock).toHaveBeenCalledTimes(3);
    expect((createMock.mock.calls[0]?.[0] as { input: string[] }).input).toHaveLength(2048);
    expect((createMock.mock.calls[1]?.[0] as { input: string[] }).input).toHaveLength(2048);
    expect((createMock.mock.calls[2]?.[0] as { input: string[] }).input).toHaveLength(904);
    expect(embeddings).toHaveLength(5000);
    expect(embeddings[0]).toEqual([0]);
    expect(embeddings[2048]).toEqual([2048]);
    expect(embeddings[4999]).toEqual([4999]);
  });

  it('rejects embedding responses with mismatched cardinality', async () => {
    createMock.mockResolvedValueOnce(createEmbeddingResponse([[0.1, 0.2, 0.3]]));

    const provider = createProvider();

    await expect(provider.embedBatch(['one', 'two'])).rejects.toThrow(
      'OpenAI embedding response cardinality mismatch: expected 2 embeddings, received 1',
    );
  });

  it('retries 429 and 5xx errors but fails 4xx errors immediately', async () => {
    vi.useFakeTimers();

    createMock.mockRejectedValueOnce({ status: 429 }).mockResolvedValueOnce(createEmbeddingResponse([[0.1, 0.2]]));

    const provider = createProvider();
    const retrySuccess = provider.embedBatch(['retry']);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(retrySuccess).resolves.toEqual([[0.1, 0.2]]);
    expect(createMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
    createMock.mockReset();
    createMock.mockRejectedValueOnce({ status: 401 });

    await expect(provider.embedBatch(['unauthorized'])).rejects.toEqual({ status: 401 });
    expect(createMock).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    createMock.mockReset();
    createMock.mockRejectedValue({ status: 500 });

    const finalFailure = expect(provider.embedBatch(['server-error'])).rejects.toEqual({ status: 500 });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(4_000);
    await finalFailure;
    expect(createMock).toHaveBeenCalledTimes(4);
  });

  it('counts tokens with the phase 1 heuristic', () => {
    expect(countTokens('hello world')).toBeGreaterThan(0);
    expect(countTokens('a'.repeat(17))).toBe(5);
  });

  it('probes embedding dimensions from a provider', async () => {
    const embedBatchMock = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3, 0.4]]);
    const provider: EmbeddingProvider = {
      embedBatch: embedBatchMock,
      getModelId: () => 'test-model',
    };

    await expect(getEmbeddingDimension(provider)).resolves.toBe(4);
    expect(embedBatchMock).toHaveBeenCalledWith(['hello']);
  });
});

function createProvider(overrides: Partial<ConstructorParameters<typeof OpenAIEmbeddingProvider>[0]> = {}) {
  return new OpenAIEmbeddingProvider({
    provider: 'openai',
    modelId: 'text-embedding-3-small',
    encryptedApiKeyRef: 'TEST_OPENAI_API_KEY',
    ...overrides,
  });
}

function createEmbeddingResponse(embeddings: number[][]) {
  return {
    data: embeddings.map((embedding, index) => ({
      index,
      embedding,
    })),
  };
}
