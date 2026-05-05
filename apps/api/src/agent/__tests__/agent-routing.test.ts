import 'reflect-metadata';

import { spawn } from 'node:child_process';
import { chatMessages, model_configs, chatSessions, spaces } from '@cherrygraph/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import type { AgentService } from '../agent.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import { ChatService } from '../../chat/chat.service.js';
import {
  ScriptedDb,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createSpaceRow,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { collectAsync } from './agent-test-utils.js';

void spawn;

type ChatSessionRow = typeof chatSessions.$inferSelect;
type ChatMessageRow = typeof chatMessages.$inferSelect;
type ModelConfigRow = typeof model_configs.$inferSelect;
type SpaceRow = typeof spaces.$inferSelect;

describe('Agent routing', () => {
  it('deep analysis toggle forces the Agent path instead of static provider streaming', async () => {
    const agent = createAgentServiceMock([
      { type: 'message.delta', delta: 'agent answer' },
      { type: 'message.completed', usage: { input_tokens: 3, output_tokens: 2 } },
    ]);
    const { service, db, chatFactory } = createService(agent);
    queuePreparedAgentCompletion(db);

    const events = await collectAsync(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [],
        message: 'run a deep analysis',
        enableDeepAnalysis: true,
      }),
    );

    expect(agent.spawnNew).toHaveBeenCalledWith( // eslint-disable-line @typescript-eslint/unbound-method
      'session-1',
      TEST_SPACE_ID,
      'run a deep analysis',
      expect.objectContaining({ enableDatabase: false }),
    );
    expect(chatFactory).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['session', 'content', 'usage', 'message.completed']);
  });

  it('propagates Agent errors as chat SSE errors', async () => {
    const agent = createAgentServiceMock([
      { type: 'message.error', code: 'process_error', message: 'Claude failed' },
    ]);
    const { service, db } = createService(agent);
    queuePreparedAgentCompletion(db);

    const events = await collectAsync(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [],
        message: 'run a deep analysis',
        enableDeepAnalysis: true,
      }),
    );

    expect(events).toEqual([
      { type: 'session', session_id: 'session-1' },
      { type: 'error', code: 'process_error', message: 'Claude failed' },
    ]);
  });
});

function createService(agentService: AgentService): {
  service: ChatService;
  db: ScriptedDb;
  chatFactory: ReturnType<typeof vi.fn>;
} {
  const db = new ScriptedDb();
  const audit = { push: vi.fn() } as unknown as AuditService;
  const chatFactory = vi.fn(() => {
    throw new Error('static chat provider should not be used');
  });
  const embeddingFactory = vi.fn(() => {
    throw new Error('embedding provider should not be used');
  });
  const service = new ChatService(
    db.asDrizzle(),
    audit,
    chatFactory,
    embeddingFactory,
    agentService,
  );

  return { service, db, chatFactory };
}

function queuePreparedAgentCompletion(db: ScriptedDb, space: SpaceRow = createSpaceRow()): void {
  db.queueSelect([space]);
  db.queueSelect([createModelRow()]);
  db.queueInsert([createSessionRow()]);
  db.queueSelect([createSessionRow()]);
  db.queueSelect([]);
  db.queueInsert([createMessageRow({ id: 'user-message', role: 'user' })]);
  db.queueInsert([createMessageRow({ id: 'assistant-message', role: 'assistant' })]);
}

function createAgentServiceMock(events: ChatAgentEvent[]): AgentService {
  return {
    hasSession: vi.fn(() => false),
    spawnNew: vi.fn(() => toAsyncIterable(events)),
    resume: vi.fn(() => toAsyncIterable(events)),
  } as unknown as AgentService;
}

type ChatAgentEvent = Parameters<AgentService['spawnNew']>[3] extends never ? never : Awaited<ReturnType<AgentService['spawnNew']>> extends AsyncGenerator<infer T> ? T : never;

// eslint-disable-next-line @typescript-eslint/require-await
async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
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

function createMessageRow(overrides: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    id: 'message-1',
    session_id: 'session-1',
    role: 'assistant',
    content: 'answer',
    token_count: null,
    citations_json: [],
    metadata_json: {},
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
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
