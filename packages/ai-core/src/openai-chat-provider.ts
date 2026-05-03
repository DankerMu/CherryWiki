import OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';

import type { ChatChunk, ChatCompletionParams, ChatMessage, ChatProvider, ChatProviderConfig } from './chat-provider.js';

const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;
const MAX_RETRY_AFTER_MS = 30_000;

type ChatUsage = Extract<ChatChunk, { type: 'done' }>['usage'];

export class OpenAIChatProvider implements ChatProvider {
  private readonly client: OpenAI;

  constructor(private readonly config: ChatProviderConfig) {
    const envVarName = resolveApiKeyRef(config.encryptedApiKeyRef);
    const apiKey = process.env[envVarName];

    if (!apiKey) {
      throw new Error(`Missing chat API key: environment variable ${envVarName} is not set (ref: ${config.encryptedApiKeyRef})`);
    }

    this.client = new OpenAI({
      apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
  }

  async *streamCompletion(params: ChatCompletionParams): AsyncIterable<ChatChunk> {
    const messages = buildMessages(params);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, REQUEST_TIMEOUT_MS);

      try {
        const stream = await this.client.chat.completions.create(buildRequest(params, messages, this.config.maxTokens), {
          signal: abortController.signal,
        });
        let finishReason: string | null = null;
        let usage = emptyUsage();
        let timeoutCleared = false;

        for await (const chunk of stream) {
          if (!timeoutCleared) {
            clearTimeout(timeoutId);
            timeoutCleared = true;
          }

          const choice = chunk.choices[0];
          const delta = choice?.delta.content;

          if (typeof delta === 'string' && delta.length > 0) {
            yield { type: 'content', delta };
          }

          if (typeof choice?.finish_reason === 'string') {
            finishReason = choice.finish_reason;
          }

          if (chunk.usage) {
            usage = normalizeUsage(chunk.usage);
          }
        }

        yield { type: 'done', finish_reason: finishReason, usage };
        return;
      } catch (error) {
        if (isRateLimitError(error) && attempt === 0) {
          clearTimeout(timeoutId);
          await sleep(getRetryAfterMs(error));
          continue;
        }

        yield { type: 'error', error: getErrorMessage(error) };
        return;
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }
}

function buildMessages(params: ChatCompletionParams): ChatCompletionMessageParam[] {
  const messages: ChatMessage[] =
    typeof params.systemPrompt === 'string' && params.systemPrompt.length > 0
      ? [{ role: 'system', content: params.systemPrompt }, ...params.messages]
      : params.messages;

  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function buildRequest(
  params: ChatCompletionParams,
  messages: ChatCompletionMessageParam[],
  configuredMaxTokens: number | undefined,
): ChatCompletionCreateParamsStreaming {
  const maxTokens = resolveMaxTokens(params.max_tokens, configuredMaxTokens);

  return {
    model: params.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
    ...(typeof maxTokens === 'number' ? { max_tokens: maxTokens } : {}),
  };
}

function resolveMaxTokens(requestedMaxTokens: number | undefined, configuredMaxTokens: number | undefined): number | undefined {
  const requested = normalizePositiveInteger(requestedMaxTokens);
  const configured = normalizePositiveInteger(configuredMaxTokens);

  if (typeof requested === 'number' && typeof configured === 'number') {
    return Math.min(requested, configured);
  }

  return requested ?? configured;
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return undefined;
  }

  return Math.floor(value);
}

function normalizeUsage(usage: ChatCompletionChunk['usage']): ChatUsage {
  if (!usage) {
    return emptyUsage();
  }

  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  };
}

function emptyUsage(): ChatUsage {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
}

function isRateLimitError(error: unknown): boolean {
  return getErrorStatus(error) === 429;
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function getRetryAfterMs(error: unknown): number {
  const retryAfter = getHeaderValue(error, 'retry-after') ?? getHeaderValue(error, 'Retry-After');

  if (!retryAfter) {
    return DEFAULT_RETRY_AFTER_MS;
  }

  const retryAfterSeconds = Number(retryAfter);

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1_000, MAX_RETRY_AFTER_MS);
  }

  const retryAfterDate = Date.parse(retryAfter);

  if (Number.isFinite(retryAfterDate)) {
    return Math.min(Math.max(retryAfterDate - Date.now(), 0), MAX_RETRY_AFTER_MS);
  }

  return DEFAULT_RETRY_AFTER_MS;
}

function getHeaderValue(error: unknown, headerName: string): string | undefined {
  if (typeof error !== 'object' || error === null || !('headers' in error)) {
    return undefined;
  }

  const headers = (error as { headers?: unknown }).headers;

  if (typeof headers !== 'object' || headers === null) {
    return undefined;
  }

  const headerGetter = (headers as { get?: (name: string) => unknown }).get;

  if (typeof headerGetter === 'function') {
    const value = headerGetter.call(headers, headerName);
    return typeof value === 'string' ? value : undefined;
  }

  const headerRecord = headers as Record<string, unknown>;
  const value = headerRecord[headerName] ?? headerRecord[headerName.toLowerCase()];

  return typeof value === 'string' ? value : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : 'OpenAI chat completion failed';
  }

  return 'OpenAI chat completion failed';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveApiKeyRef(ref: string): string {
  if (ref.startsWith('secret:')) {
    return ref.slice(7);
  }

  return ref;
}
