import 'reflect-metadata';

import { spawn } from 'node:child_process';
import { chatMessages, model_configs, chatSessions, spaces } from '@cherrygraph/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { AgentSessionBusyError, type AgentService } from '../agent.service.js';
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

    expect(agent.sendTurn).toHaveBeenCalledWith( // eslint-disable-line @typescript-eslint/unbound-method
      'session-1',
      TEST_SPACE_ID,
      'run a deep analysis',
      expect.objectContaining({ enableDatabase: false }),
    );
    expect(chatFactory).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['session', 'content', 'usage', 'message.completed']);
  });

  it('bound Agent conversations continue on the Agent path without static retrieval', async () => {
    const agent = createAgentServiceMock([
      { type: 'message.delta', delta: 'resumed answer' },
      { type: 'message.completed', usage: { input_tokens: 5, output_tokens: 3 } },
    ]);
    const hasSession = vi.fn(() => Promise.resolve(true));
    agent.hasSession = hasSession as unknown as AgentService['hasSession'];
    const { service, db, chatFactory, embeddingFactory } = createService(agent);
    db.queueSelect([createSessionRow()]);
    db.queueSelect([]);
    db.queueSelect([createModelRow()]);
    db.queueSelect([createSpaceRow()]);
    db.queueSelect([]);
    db.queueInsert([createMessageRow({ id: 'user-message', role: 'user' })]);
    db.queueInsert([createMessageRow({ id: 'assistant-message', role: 'assistant' })]);

    const events = await collectAsync(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        sessionId: 'session-1',
        userId: TEST_USER_ID,
        userGroupIds: [],
        message: 'continue the previous analysis',
      }),
    );

    expect(hasSession).toHaveBeenCalledWith('session-1', { includePersisted: true });
    expect(agent.sendTurn).toHaveBeenCalledWith( // eslint-disable-line @typescript-eslint/unbound-method
      'session-1',
      TEST_SPACE_ID,
      'continue the previous analysis',
      expect.objectContaining({ enableDatabase: false }),
    );
    expect(chatFactory).not.toHaveBeenCalled();
    expect(embeddingFactory).not.toHaveBeenCalled();
    expect(db.executedQueries).toHaveLength(0);
    expect(events.map((event) => event.type)).toEqual(['session', 'content', 'usage', 'message.completed']);
  });

  it('database toggle routes to Agent when database config is visible', async () => {
    const agent = createAgentServiceMock([
      { type: 'message.delta', delta: 'database answer' },
      { type: 'message.completed', usage: { input_tokens: 4, output_tokens: 2 } },
    ]);
    const { service, db, chatFactory, embeddingFactory } = createService(agent);
    queuePreparedAgentCompletion(
      db,
      createSpaceRow({
        database_config: {
          enabled: true,
          dsn: 'postgresql://readonly:secret@db.internal:5432/analytics',
          allowed_tables: ['orders'],
        },
      }),
    );

    await collectAsync(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [],
        message: 'query orders',
        enableDatabase: true,
      }),
    );

    const { sendTurn } = agent as unknown as { sendTurn: ReturnType<typeof vi.fn> };
    expect(sendTurn).toHaveBeenCalledWith(
      'session-1',
      TEST_SPACE_ID,
      'query orders',
      expect.objectContaining({ enableDatabase: true }),
    );
    const options = sendTurn.mock.calls[0]?.[3] as { databaseConfig?: unknown } | undefined;
    expect(options?.databaseConfig).toEqual(
      expect.objectContaining({
        dsn: 'postgresql://readonly:secret@db.internal:5432/analytics',
        allowed_tables: ['orders'],
      }),
    );
    expect(chatFactory).not.toHaveBeenCalled();
    expect(embeddingFactory).not.toHaveBeenCalled();
    expect(db.executedQueries).toHaveLength(0);
  });

  it('keeps single-space database requests on static RAG when database config is not visible', async () => {
    const agent = createAgentServiceMock([
      { type: 'message.delta', delta: 'agent should not run' },
      { type: 'message.completed', usage: { input_tokens: 4, output_tokens: 2 } },
    ]);
    const { service, db, chatFactory, embeddingFactory } = createService(agent);
    queuePreparedAgentCompletion(db, createSpaceRow({ database_config: { enabled: false } }));
    db.queueSelect([]);
    db.queueInsert([createMessageRow({ id: 'assistant-no-hit', role: 'assistant' })]);

    const events = await collectAsync(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [],
        message: 'query orders',
        enableDatabase: true,
      }),
    );

    expect(agent.sendTurn).not.toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/unbound-method
    expect(chatFactory).not.toHaveBeenCalled();
    expect(embeddingFactory).not.toHaveBeenCalled();
    expect(db.executedQueries).toHaveLength(0);
    expect(events.map((event) => event.type)).toEqual(['session', 'content', 'citations', 'usage', 'message.completed']);
    expect(events.some((event) => 'database_mode' in event)).toBe(false);
    expect([...db.inserts].reverse().find((insert) => insert.table === chatMessages)?.value).toMatchObject({
      metadata_json: { source: 'no_hit' },
    });
  });

  it('disables database dispatch for single-space Agent turns when the database config is not visible', async () => {
    const agent = createAgentServiceMock([
      { type: 'message.delta', delta: 'agent answer' },
      { type: 'message.completed', usage: { input_tokens: 4, output_tokens: 2 } },
    ]);
    const { service, db } = createService(agent);
    queuePreparedAgentCompletion(db, createSpaceRow({ database_config: { enabled: false } }));

    const events = await collectAsync(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [],
        message: 'run a deep analysis over orders',
        enableDeepAnalysis: true,
        enableDatabase: true,
      }),
    );

    expect(agent.sendTurn).toHaveBeenCalledWith( // eslint-disable-line @typescript-eslint/unbound-method
      'session-1',
      TEST_SPACE_ID,
      'run a deep analysis over orders',
      expect.objectContaining({
        enableDatabase: false,
      }),
    );
    const options = (agent.sendTurn as ReturnType<typeof vi.fn>).mock.calls[0]?.[3] as { databaseConfig?: unknown } | undefined;
    expect(options).not.toHaveProperty('databaseConfig');
    expect(events.at(-1)).toEqual({ type: 'message.completed' });
    expect([...db.inserts].reverse().find((insert) => insert.table === chatMessages)?.value).toMatchObject({
      metadata_json: { source: 'agent', database_mode: 'disabled' },
    });
  });

  it('passes all selected Spaces and disables database mode for multi-space turns', async () => {
    const agent = createAgentServiceMock([
      { type: 'message.delta', delta: 'agent answer' },
      { type: 'message.completed', usage: { input_tokens: 3, output_tokens: 2 } },
    ]);
    const { service, db } = createService(agent);
    db.queueSelect([createSpaceRow({ id: 'space-a', name: 'Space A', database_config: { enabled: true } })]);
    db.queueSelect([createSpaceRow({ id: 'space-b', name: 'Space B', database_config: { enabled: true } })]);
    db.queueSelect([createModelRow()]);
    db.queueInsert([createSessionRow({ space_id: 'space-a' })]);
    db.queueSelect([createSessionRow({ space_id: 'space-a' })]);
    db.queueSelect([]);
    db.queueInsert([createMessageRow({ id: 'user-message', role: 'user' })]);
    db.queueInsert([createMessageRow({ id: 'assistant-message', role: 'assistant' })]);

    const events = await collectAsync(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: 'space-a',
        spaceIds: ['space-a', 'space-b'],
        userId: TEST_USER_ID,
        userGroupIds: [],
        message: 'run a deep analysis',
        enableDeepAnalysis: true,
        enableDatabase: true,
      }),
    );

    expect(events.at(-1)).toEqual({ type: 'message.completed', database_mode: 'unavailable_multi_space' });
    expect(agent.sendTurn).toHaveBeenCalledWith( // eslint-disable-line @typescript-eslint/unbound-method
      'session-1',
      'space-a',
      'run a deep analysis',
      expect.objectContaining({
        allowedSpaces: [
          { id: 'space-a', name: 'Space A' },
          { id: 'space-b', name: 'Space B' },
        ],
        enableDatabase: false,
      }),
    );
    expect((agent.sendTurn as ReturnType<typeof vi.fn>).mock.calls[0]?.[3]).not.toHaveProperty('databaseConfig');
    expect([...db.inserts].reverse().find((insert) => insert.table === chatMessages)?.value).toMatchObject({
      metadata_json: { source: 'agent', database_mode: 'unavailable_multi_space' },
    });
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

  it('maps AgentSessionBusyError to the public chat SSE busy error', async () => {
    const agent = createAgentServiceMock([]);
    const busyError = new AgentSessionBusyError('session-1');
    agent.sendTurn = vi.fn(() => toThrowingAsyncIterable<ChatAgentEvent>(busyError));
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
      { type: 'error', code: 'agent_session_busy', message: 'Agent session session-1 is busy with another turn' },
    ]);
  });
});

function createService(agentService: AgentService): {
  service: ChatService;
  db: ScriptedDb;
  chatFactory: ReturnType<typeof vi.fn>;
  embeddingFactory: ReturnType<typeof vi.fn>;
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

  return { service, db, chatFactory, embeddingFactory };
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
    close: vi.fn(() => Promise.resolve()),
    hasSession: vi.fn(() => false),
    sendTurn: vi.fn(() => toAsyncIterable(events)),
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

async function* toThrowingAsyncIterable<T>(error: Error): AsyncGenerator<T> {
  yield await Promise.reject(error);
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
