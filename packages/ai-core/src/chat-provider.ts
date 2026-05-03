export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type ChatCompletionParams = {
  messages: ChatMessage[];
  model: string;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  systemPrompt?: string;
};

export type ChatChunk =
  | { type: 'content'; delta: string }
  | {
      type: 'done';
      finish_reason: string | null;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    }
  | { type: 'error'; error: string };

export interface ChatProvider {
  streamCompletion(params: ChatCompletionParams): AsyncIterable<ChatChunk>;
}

export type ChatProviderConfig = {
  provider: string;
  modelId: string;
  baseUrl?: string;
  encryptedApiKeyRef: string;
  maxTokens?: number;
};
