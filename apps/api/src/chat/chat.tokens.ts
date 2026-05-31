import type {
  ChatProvider,
  ChatProviderConfig,
  EmbeddingProvider,
  EmbeddingProviderConfig,
} from '@cherrygraph/ai-core';

export const CHAT_PROVIDER_FACTORY = Symbol('CHAT_PROVIDER_FACTORY');
export const EMBEDDING_PROVIDER_FACTORY = Symbol('EMBEDDING_PROVIDER_FACTORY');

export type ChatProviderFactory = (config: ChatProviderConfig) => ChatProvider;
export type EmbeddingProviderFactory = (config: EmbeddingProviderConfig) => EmbeddingProvider;
