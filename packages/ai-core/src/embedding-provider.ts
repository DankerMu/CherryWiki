export interface EmbeddingProvider {
  embedBatch(texts: string[]): Promise<number[][]>;
  getModelId(): string;
}

export type EmbeddingProviderConfig = {
  provider: string;
  modelId: string;
  baseUrl?: string;
  encryptedApiKeyRef: string;
  embeddingDim?: number;
  maxBatchSize?: number;
};
