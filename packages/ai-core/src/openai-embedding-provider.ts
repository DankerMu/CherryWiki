import OpenAI from 'openai';

import type { EmbeddingProvider, EmbeddingProviderConfig } from './embedding-provider.js';

const DEFAULT_MAX_BATCH_SIZE = 2048;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly client: OpenAI;
  private readonly maxBatchSize: number;

  constructor(private readonly config: EmbeddingProviderConfig) {
    const apiKey = process.env[config.encryptedApiKeyRef];

    if (!apiKey) {
      throw new Error(`Missing embedding API key: environment variable ${config.encryptedApiKeyRef} is not set`);
    }

    this.client = new OpenAI({
      apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    this.maxBatchSize = normalizeMaxBatchSize(config.maxBatchSize);
  }

  getModelId(): string {
    return this.config.modelId;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const embeddings: number[][] = [];

    for (let start = 0; start < texts.length; start += this.maxBatchSize) {
      const batch = texts.slice(start, start + this.maxBatchSize);
      embeddings.push(...(await this.embedBatchOnce(batch)));
    }

    return embeddings;
  }

  private async embedBatchOnce(texts: string[]): Promise<number[][]> {
    const response = await retryOpenAIRequest(() =>
      this.client.embeddings.create({
        model: this.config.modelId,
        input: texts,
      }),
    );

    const sortedData = [...response.data].sort((left, right) => left.index - right.index);

    if (sortedData.length !== texts.length) {
      throw new Error(
        `OpenAI embedding response cardinality mismatch: expected ${texts.length} embeddings, received ${sortedData.length}`,
      );
    }

    return sortedData.map((item) => item.embedding);
  }
}

function normalizeMaxBatchSize(maxBatchSize: number | undefined): number {
  if (typeof maxBatchSize !== 'number' || !Number.isFinite(maxBatchSize) || maxBatchSize < 1) {
    return DEFAULT_MAX_BATCH_SIZE;
  }

  return Math.floor(maxBatchSize);
}

async function retryOpenAIRequest<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableOpenAIError(error) || attempt === RETRY_DELAYS_MS.length) {
        throw error;
      }

      const delayMs = RETRY_DELAYS_MS[attempt];

      if (delayMs === undefined) {
        throw error;
      }

      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OpenAI embedding request failed');
}

function isRetryableOpenAIError(error: unknown): boolean {
  const status = getErrorStatus(error);
  return status === 429 || (typeof status === 'number' && status >= 500);
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
