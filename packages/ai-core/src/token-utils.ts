import type { EmbeddingProvider } from './embedding-provider.js';

export function countTokens(text: string, model?: string): number {
  void model;

  return Math.ceil(text.length / 4);
}

export async function getEmbeddingDimension(provider: EmbeddingProvider): Promise<number> {
  const [embedding] = await provider.embedBatch(['hello']);

  if (!embedding) {
    throw new Error('Embedding provider returned no vector for dimension probe');
  }

  return embedding.length;
}
