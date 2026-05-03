import type { EmbeddingProvider } from './embedding-provider.js';

const TIKTOKEN_COMPATIBLE_MODEL_PREFIXES = [
  'gpt-4o',
  'gpt-4.1',
  'gpt-4',
  'gpt-3.5-turbo',
  'o1',
  'o3',
  'o4',
] as const;

export function countTokens(text: string, model?: string): number {
  const normalizedModel = model?.trim().toLowerCase();

  if (normalizedModel && isTiktokenCompatibleModel(normalizedModel)) {
    // The project does not currently depend on tiktoken. Keep this branch explicit so
    // a future synchronous encoder lookup can slot in here without changing callers.
    return approximateTokenCount(text);
  }

  return approximateTokenCount(text);
}

function isTiktokenCompatibleModel(model: string): boolean {
  return TIKTOKEN_COMPATIBLE_MODEL_PREFIXES.some((prefix) => model === prefix || model.startsWith(`${prefix}-`));
}

function approximateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function getEmbeddingDimension(provider: EmbeddingProvider): Promise<number> {
  const [embedding] = await provider.embedBatch(['hello']);

  if (!embedding) {
    throw new Error('Embedding provider returned no vector for dimension probe');
  }

  return embedding.length;
}
