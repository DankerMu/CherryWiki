import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatCompletionChunk, ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';

import { OpenAIChatProvider, countTokens, type ChatChunk, type ChatCompletionParams } from '../index.js';

const { createMock, openAIConstructorMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  openAIConstructorMock: vi.fn(),
}));

vi.mock('openai', () => ({
  default: openAIConstructorMock.mockImplementation(function OpenAIMock() {
    return {
      chat: {
        completions: {
          create: createMock,
        },
      },
    };
  }),
}));

describe('OpenAIChatProvider', () => {
  beforeEach(() => {
    process.env.TEST_OPENAI_API_KEY = 'test-key';
    createMock.mockReset();
    openAIConstructorMock.mockClear();
  });

  afterEach(() => {
    delete process.env.TEST_OPENAI_API_KEY;
    vi.useRealTimers();
  });

  it('streams content and final usage chunks', async () => {
    createMock.mockResolvedValueOnce(
      createOpenAIStream([
        createChunk({ delta: 'Hel' }),
        createChunk({ delta: 'lo', finishReason: 'stop' }),
        createChunk({ usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }),
      ]),
    );

    const provider = createProvider();

    await expect(collectChunks(provider.streamCompletion(createParams()))).resolves.toEqual([
      { type: 'content', delta: 'Hel' },
      { type: 'content', delta: 'lo' },
      {
        type: 'done',
        finish_reason: 'stop',
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      },
    ]);
  });

  it('prepends systemPrompt as the first outgoing OpenAI message', async () => {
    createMock.mockResolvedValueOnce(createOpenAIStream([createChunk({ finishReason: 'stop' })]));

    const provider = createProvider();
    await collectChunks(
      provider.streamCompletion(
        createParams({
          systemPrompt: 'Answer only from retrieved context.',
          messages: [{ role: 'user', content: 'What changed?' }],
        }),
      ),
    );

    expect(getCreateParams().messages).toEqual([
      { role: 'system', content: 'Answer only from retrieved context.' },
      { role: 'user', content: 'What changed?' },
    ]);
  });

  it('aborts requests after the 60s timeout and yields an error chunk', async () => {
    vi.useFakeTimers();
    createMock.mockImplementation((_params: unknown, options?: { signal?: AbortSignal }) => {
      return new Promise<AsyncIterable<ChatCompletionChunk>>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new Error('Request aborted'));
        });
      });
    });

    const provider = createProvider();
    const chunksPromise = collectChunks(provider.streamCompletion(createParams()));

    await vi.advanceTimersByTimeAsync(60_000);

    await expect(chunksPromise).resolves.toEqual([{ type: 'error', error: 'Request aborted' }]);
    expect(getCreateOptions().signal?.aborted).toBe(true);
  });

  it('retries one 429 response after Retry-After and then streams successfully', async () => {
    vi.useFakeTimers();
    createMock
      .mockRejectedValueOnce(createRateLimitError('2'))
      .mockResolvedValueOnce(createOpenAIStream([createChunk({ delta: 'ok', finishReason: 'stop' })]));

    const provider = createProvider();
    const chunksPromise = collectChunks(provider.streamCompletion(createParams()));

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(chunksPromise).resolves.toEqual([
      { type: 'content', delta: 'ok' },
      {
        type: 'done',
        finish_reason: 'stop',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      },
    ]);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('returns an error chunk when a retried 429 response fails again', async () => {
    vi.useFakeTimers();
    createMock.mockRejectedValue(createRateLimitError('0'));

    const provider = createProvider();
    const chunksPromise = collectChunks(provider.streamCompletion(createParams()));

    await vi.advanceTimersByTimeAsync(0);

    await expect(chunksPromise).resolves.toEqual([{ type: 'error', error: 'rate limited' }]);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('counts tokens for known and unknown models with the synchronous fallback', () => {
    expect(countTokens('a'.repeat(17), 'gpt-4o')).toBe(5);
    expect(countTokens('a'.repeat(17), 'custom-model-xyz')).toBe(5);
  });
});

function createProvider(overrides: Partial<ConstructorParameters<typeof OpenAIChatProvider>[0]> = {}) {
  return new OpenAIChatProvider({
    provider: 'openai',
    modelId: 'gpt-4o',
    encryptedApiKeyRef: 'TEST_OPENAI_API_KEY',
    ...overrides,
  });
}

function createParams(overrides: Partial<ChatCompletionParams> = {}): ChatCompletionParams {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    model: 'gpt-4o',
    ...overrides,
  };
}

async function collectChunks(iterable: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const chunks: ChatChunk[] = [];

  for await (const chunk of iterable) {
    chunks.push(chunk);
  }

  return chunks;
}

function createOpenAIStream(chunks: ChatCompletionChunk[]): AsyncIterable<ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();

      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;

function createChunk({
  delta,
  finishReason = null,
  usage,
}: {
  delta?: string;
  finishReason?: FinishReason;
  usage?: ChatCompletionChunk['usage'];
}): ChatCompletionChunk {
  const choices: ChatCompletionChunk['choices'] =
    typeof delta === 'string' || finishReason !== null
      ? [
          {
            delta: typeof delta === 'string' ? { content: delta } : {},
            finish_reason: finishReason,
            index: 0,
          },
        ]
      : [];
  const chunk: ChatCompletionChunk = {
    id: 'chatcmpl-test',
    choices,
    created: 1,
    model: 'gpt-4o',
    object: 'chat.completion.chunk',
  };

  return usage ? { ...chunk, usage } : chunk;
}

function getCreateParams(): ChatCompletionCreateParamsStreaming {
  const params = getFirstCreateCall()[0];

  if (!params) {
    throw new Error('OpenAI chat completion create was not called');
  }

  return params as ChatCompletionCreateParamsStreaming;
}

function getCreateOptions(): { signal?: AbortSignal } {
  const options = getFirstCreateCall()[1];

  if (!isCreateOptions(options)) {
    throw new Error('OpenAI chat completion create was not called with options');
  }

  return options;
}

function getFirstCreateCall(): readonly unknown[] {
  const calls: unknown = createMock.mock.calls;

  if (!isUnknownArray(calls)) {
    throw new Error('OpenAI chat completion create calls are unavailable');
  }

  const firstCall = calls[0];

  if (!isUnknownArray(firstCall)) {
    throw new Error('OpenAI chat completion create was not called');
  }

  return firstCall;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isCreateOptions(value: unknown): value is { signal?: AbortSignal } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const signal = (value as { signal?: unknown }).signal;
  return typeof signal === 'undefined' || signal instanceof AbortSignal;
}

function createRateLimitError(retryAfter: string) {
  return {
    status: 429,
    message: 'rate limited',
    headers: {
      'retry-after': retryAfter,
    },
  };
}
