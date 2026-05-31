import '../../apps/api/node_modules/reflect-metadata/Reflect.js';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import type { AuditService } from '../../apps/api/src/audit/audit.service.js';
import { AgentService } from '../../apps/api/src/agent/agent.service.js';
import type {
  AgentSessionRepository,
  AgentSessionRow,
  NewAgentSession,
} from '../../apps/api/src/agent/agent-session.repository.js';
import { AuditCapture } from '../../apps/api/src/agent/audit-capture.js';
import { ClaudeMdGenerator } from '../../apps/api/src/agent/claude-md-generator.js';
import { SessionManager } from '../../apps/api/src/agent/session-manager.js';
import { SettingsGenerator } from '../../apps/api/src/agent/settings-generator.js';
import { StreamParser } from '../../apps/api/src/agent/stream-parser.js';
import {
  createMockProcess,
  type MockAgentProcess,
  writeJsonLine,
} from '../../apps/api/src/agent/__tests__/agent-test-utils.js';
import type { DrizzleDatabase } from '../../apps/api/src/database/drizzle.module.js';
import { ChatService } from '../../apps/api/src/chat/chat.service.js';
import {
  collectAsync,
  createRealAgentService,
} from './agent-integration-test-utils.js';
import {
  collectEvents,
  createMessageRow,
  createModelRow,
  createSessionRow,
  createSpaceRow,
  queueAssistantMessage,
  queueStreamPrelude,
  ScriptedChatDb,
  ScriptedChatProvider,
  ScriptedEmbeddingProvider,
  TEST_GROUP_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from './chat-integration-test-utils.js';

const spawnMock = vi.mocked(spawn);
const managers: SessionManager[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(managers.splice(0).map((manager) => manager.onModuleDestroy()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('persistent Agent runtime integration', () => {
  it('reuses one resident process across two Chat Agent turns while preserving tool, chart, and usage SSE events', async () => {
    const proc = createMockProcess();
    const stdinChunks = captureStdin(proc);
    spawnMock.mockReturnValue(proc as never);
    const db = new ScriptedChatDb();
    const audit = { push: vi.fn() } as unknown as AuditService;
    const agentService = createRealAgentService({ db, audit, managers });
    const chatProvider = new ScriptedChatProvider([]);
    const embeddingProvider = new ScriptedEmbeddingProvider();
    const service = new ChatService(
      db.asDrizzle(),
      audit,
      () => chatProvider,
      () => embeddingProvider,
      agentService,
    );
    const chatSessionId = uniqueId('chat-agent-persistent');

    queueStreamPrelude(db, { session: createSessionRow({ id: chatSessionId }) });
    queueAssistantMessage(db, { id: 'assistant-agent-1', session_id: chatSessionId });
    const firstIterable = await service.streamCompletion({
      tenantId: TEST_TENANT_ID,
      spaceId: TEST_SPACE_ID,
      userId: TEST_USER_ID,
      userGroupIds: [TEST_GROUP_ID],
      message: 'show SSO graph evidence',
      enableDeepAnalysis: true,
    });
    const firstEventsPromise = collectEvents(firstIterable);
    await waitForSpawn(1);
    writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: 'provider-chat-persistent' });
    await vi.waitFor(() => expect(stdinChunks.join('')).toContain('show SSO graph evidence'));
    writeJsonLine(proc, {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'graph-tool', name: 'Bash', input: { command: 'graphify query "SSO"' } },
          { type: 'text', text: 'SSO connects to session management.' },
        ],
      },
    });
    writeJsonLine(proc, {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            content: JSON.stringify({
              type: 'cherrywiki.chart',
              chart_type: 'bar',
              echarts_option: { xAxis: { data: ['SSO'] }, series: [{ data: [1] }] },
            }),
          },
        ],
      },
    });
    writeJsonLine(proc, {
      type: 'result',
      subtype: 'success',
      session_id: 'provider-chat-persistent',
      usage: { input_tokens: 21, output_tokens: 8 },
    });

    expect(await firstEventsPromise).toMatchObject([
      { type: 'session', session_id: chatSessionId },
      { type: 'agent.tool_use', id: 'graph-tool', name: 'Bash', input: { command: 'graphify query "SSO"' } },
      { type: 'content', delta: 'SSO connects to session management.' },
      { type: 'chart.data', data: { type: 'cherrywiki.chart', chart_type: 'bar' } },
      { type: 'usage', usage: { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 } },
      { type: 'message.completed' },
    ]);

    queueExistingSessionPrelude(db, chatSessionId);
    queueAssistantMessage(db, { id: 'assistant-agent-2', session_id: chatSessionId });
    const secondIterable = await service.streamCompletion({
      tenantId: TEST_TENANT_ID,
      spaceId: TEST_SPACE_ID,
      userId: TEST_USER_ID,
      userGroupIds: [TEST_GROUP_ID],
      sessionId: chatSessionId,
      message: 'continue from that graph',
      enableDeepAnalysis: true,
    });
    const secondEventsPromise = collectEvents(secondIterable);
    await vi.waitFor(() => expect(stdinChunks.join('')).toContain('continue from that graph'));
    writeJsonLine(proc, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Continuing with the same resident process.' }] },
    });
    writeJsonLine(proc, {
      type: 'result',
      subtype: 'success',
      session_id: 'provider-chat-persistent',
      usage: { input_tokens: 7, output_tokens: 6 },
    });

    expect(await secondEventsPromise).toMatchObject([
      { type: 'session', session_id: chatSessionId },
      { type: 'content', delta: 'Continuing with the same resident process.' },
      { type: 'usage', usage: { prompt_tokens: 7, completion_tokens: 6, total_tokens: 13 } },
      { type: 'message.completed' },
    ]);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    proc.close(0);
  });

  it('resumes from persisted metadata after an API runtime restart', async () => {
    const first = createClosingOnKillProcess();
    const firstStdin = captureStdin(first);
    const resumed = createMockProcess();
    const resumedStdin = captureStdin(resumed);
    spawnMock.mockReturnValueOnce(first as never).mockReturnValueOnce(resumed as never);
    const repository = createRepository();
    const agentRoot = await createTempDir('agent-runtime-restart-root');
    const conversationId = uniqueId('agent-runtime-restart');
    const firstManager = new SessionManager(repository.instance, {
      agentRoot,
      instanceId: 'api-instance-1',
      sigintGraceMs: 1,
    });
    managers.push(firstManager);
    const firstService = createAgentService(firstManager);

    const firstTurn = collectAsync(
      firstService.sendTurn(conversationId, 'space-1', 'before restart', {
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    );
    await waitForSpawn(1);
    writeJsonLine(first, { type: 'system', subtype: 'init', session_id: 'provider-restart' });
    await vi.waitFor(() => expect(firstStdin.join('')).toContain('before restart'));
    writeJsonLine(first, { type: 'result', subtype: 'success', session_id: 'provider-restart' });
    await firstTurn;

    await firstManager.shutdown();
    const secondManager = new SessionManager(repository.instance, {
      agentRoot,
      instanceId: 'api-instance-2',
      sigintGraceMs: 1,
    });
    managers.push(secondManager);
    const secondService = createAgentService(secondManager);

    const secondTurn = collectAsync(
      secondService.sendTurn(conversationId, 'space-1', 'after restart', {
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    );
    await waitForSpawn(2);
    writeJsonLine(resumed, { type: 'system', subtype: 'init', session_id: 'provider-restart' });
    await vi.waitFor(() => expect(resumedStdin.join('')).toContain('after restart'));
    writeJsonLine(resumed, { type: 'result', subtype: 'success', session_id: 'provider-restart' });
    await secondTurn;

    expect(first.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawnMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(['--resume', 'provider-restart']));
    expect(repository.rows.get(conversationId)?.owned_by_instance).toBe('api-instance-2');

    resumed.close(0);
  });
});

function createAgentService(manager: SessionManager): AgentService {
  const db = new ScriptedChatDb();
  const audit = { push: vi.fn() } as unknown as AuditService;
  return new AgentService(
    db.asDrizzle() as unknown as DrizzleDatabase,
    manager,
    new StreamParser(),
    new AuditCapture(audit),
    new ClaudeMdGenerator(),
    new SettingsGenerator(),
  );
}

function queueExistingSessionPrelude(db: ScriptedChatDb, sessionId: string): void {
  db.queueSelect([createSessionRow({ id: sessionId })]);
  db.queueSelect([
    {
      session_id: sessionId,
      tenant_id: TEST_TENANT_ID,
      space_id: TEST_SPACE_ID,
      space_name: 'Knowledge',
      position: 0,
      created_at: new Date('2026-05-01T00:00:00.000Z'),
    },
  ]);
  db.queueSelect([createModelRow({ model_type: 'chat' })]);
  db.queueSelect([createSpaceRow()]);
  db.queueSelect([createMessageRow({ id: 'history-1', session_id: sessionId, role: 'assistant' })]);
  db.queueInsert([createMessageRow({ id: uniqueId('user-message'), session_id: sessionId, role: 'user' })]);
}

function createClosingOnKillProcess(): MockAgentProcess {
  const proc = createMockProcess();
  proc.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    proc.close(0, typeof signal === 'string' ? signal : null);
    return true;
  });
  return proc;
}

function captureStdin(proc: MockAgentProcess): string[] {
  const chunks: string[] = [];
  proc.stdin.on('data', (chunk: Buffer | string) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  });
  return chunks;
}

async function waitForSpawn(count: number): Promise<void> {
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(count));
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

function createRepository(initialRows: AgentSessionRow[] = []): {
  instance: AgentSessionRepository;
  rows: Map<string, AgentSessionRow>;
} {
  const rows = new Map(initialRows.map((row) => [row.conversation_id, { ...row }]));
  const repository = {
    upsert: vi.fn((data: NewAgentSession) => {
      const row = createAgentSessionRow({
        conversation_id: data.conversation_id,
        tenant_id: data.tenant_id,
        space_id: data.space_id,
        user_id: data.user_id,
        provider: data.provider ?? 'claude',
        provider_session_id: data.provider_session_id ?? null,
        work_dir: data.work_dir,
        agent_home: data.agent_home,
        status: data.status,
        options_hash: data.options_hash ?? null,
        owned_by_instance: data.owned_by_instance ?? null,
        last_activity_at: data.last_activity_at,
        process_started_at: data.process_started_at ?? null,
        process_stopped_at: data.process_stopped_at ?? null,
      });
      rows.set(row.conversation_id, row);
      return Promise.resolve(row);
    }),
    findByConversationId: vi.fn((conversationId: string) => Promise.resolve(rows.get(conversationId))),
    findByConversationScope: vi.fn((conversationId: string, tenantId: string, userId: string) => {
      const row = rows.get(conversationId);
      if (row?.tenant_id !== tenantId || row.user_id !== userId) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(row);
    }),
    updateProviderSessionId: vi.fn((conversationId: string, providerSessionId: string) => {
      const row = rows.get(conversationId);
      if (row !== undefined) {
        row.provider_session_id = providerSessionId;
      }
      return Promise.resolve();
    }),
    updateStatus: vi.fn((conversationId: string, status: string, extra: Partial<AgentSessionRow> = {}) => {
      const row = rows.get(conversationId);
      if (row !== undefined) {
        Object.assign(row, extra, { status, updated_at: new Date() });
      }
      return Promise.resolve();
    }),
    updateOwnedByInstance: vi.fn((conversationId: string, instanceId: string) => {
      const row = rows.get(conversationId);
      if (row !== undefined) {
        row.owned_by_instance = instanceId;
      }
      return Promise.resolve();
    }),
    touchActivity: vi.fn((conversationId: string) => {
      const row = rows.get(conversationId);
      if (row !== undefined) {
        row.last_activity_at = new Date();
      }
      return Promise.resolve();
    }),
    delete: vi.fn((conversationId: string) => {
      rows.delete(conversationId);
      return Promise.resolve();
    }),
    findStaleForRetentionCleanup: vi.fn((olderThan: Date, statuses: string[]) =>
      Promise.resolve(
        [...rows.values()].filter(
          (row) => row.last_activity_at < olderThan && statuses.includes(row.status),
        ),
      ),
    ),
  };

  return { instance: repository as unknown as AgentSessionRepository, rows };
}

function createAgentSessionRow(overrides: Partial<AgentSessionRow> = {}): AgentSessionRow {
  return {
    conversation_id: 'conversation-1',
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    user_id: 'user-1',
    provider: 'claude',
    provider_session_id: null,
    work_dir: '/tmp/cherry-agent/conversation-1',
    agent_home: '/tmp/cherry-agent/conversation-1/.home',
    status: 'idle',
    options_hash: null,
    owned_by_instance: 'api-instance-1',
    last_activity_at: new Date('2026-05-01T00:00:00.000Z'),
    process_started_at: null,
    process_stopped_at: null,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

function uniqueId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
