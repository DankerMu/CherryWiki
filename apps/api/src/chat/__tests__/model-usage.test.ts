import 'reflect-metadata';

import type { ChatChunk, ChatCompletionParams, ChatProvider, EmbeddingProvider } from '@cherrygraph/ai-core';
import { chatMessages, chatSessions, modelUsageLogs, model_configs } from '@cherrygraph/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  ScriptedDb,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
  createSpaceRow,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { ChatService } from '../chat.service.js';

type ModelConfigRow = typeof model_configs.$inferSelect;
type ChatSessionRow = typeof chatSessions.$inferSelect;

describe('static RAG model usage', () => {
  it('writes token usage to model_usage_logs with the chat model_config_id', async () => {
    const db = new ScriptedDb();
    const audit = createAuditMock();
    const chatProvider = new ScriptedChatProvider([
      { type: 'content', delta: 'General answer.' },
      { type: 'done', finish_reason: 'stop', usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } },
    ]);
    const service = new ChatService(
      db.asDrizzle(),
      audit.service,
      vi.fn(() => chatProvider),
      vi.fn(() => new ScriptedEmbeddingProvider()),
    );
    db.queueSelect([createSpaceRow({ strict_knowledge_only: false })]);
    db.queueSelect([createModelRow()]);
    db.queueInsert([createSessionRow()]);
    db.queueSelect([createSessionRow()]);
    db.queueSelect([]);
    db.queueInsert([{ id: 'user-message' }]);
    db.queueSelect([]);
    db.queueInsert([{ id: 'assistant-message' }]);

    await collectEvents(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [],
        message: 'unknown topic',
      }),
    );

    expect(db.inserts.find((insert) => insert.table === modelUsageLogs)?.value).toMatchObject({
      tenant_id: TEST_TENANT_ID,
      user_id: TEST_USER_ID,
      model_config_id: 'chat-model',
      request_type: 'static_rag',
      input_tokens: 12,
      output_tokens: 4,
      space_id: TEST_SPACE_ID,
      conversation_id: 'session-1',
    });
    expect(db.inserts.some((insert) => insert.table === chatMessages)).toBe(true);
  });
});

class ScriptedChatProvider implements ChatProvider {
  constructor(private readonly chunks: ChatChunk[]) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async *streamCompletion(params: ChatCompletionParams): AsyncIterable<ChatChunk> {
    expect(params.model).toBe('gpt-test');
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

class ScriptedEmbeddingProvider implements EmbeddingProvider {
  embedBatch(): Promise<number[][]> {
    return Promise.resolve([[0.1, 0.2]]);
  }

  getModelId(): string {
    return 'embedding-model';
  }
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

function createSessionRow(overrides: Partial<ChatSessionRow> = {}): ChatSessionRow {
  return {
    id: 'session-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    user_id: TEST_USER_ID,
    title: null,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

async function collectEvents(events: AsyncIterable<unknown>): Promise<unknown[]> {
  const collected: unknown[] = [];
  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}
