import '../../apps/api/node_modules/reflect-metadata/Reflect.js';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import type { AuditEntry, AuditService } from '../../apps/api/src/audit/audit.service.js';
import type { SessionManager } from '../../apps/api/src/agent/session-manager.js';
import { ChatService } from '../../apps/api/src/chat/chat.service.js';
import {
  createMockProcess,
  writeJsonLine,
} from '../../apps/api/src/agent/__tests__/agent-test-utils.js';
import {
  collectEvents,
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
import {
  createRealAgentService,
} from './agent-integration-test-utils.js';

const spawnMock = vi.mocked(spawn);
const managers: SessionManager[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(managers.splice(0).map((manager) => manager.onModuleDestroy()));
});

describe('cherrydb Agent integration', () => {
  it('enables database tools, streams table/query/chart events, and captures SQL audit logs', async () => {
    const proc = createMockProcess();
    const stdinChunks = captureStdin(proc);
    spawnMock.mockReturnValue(proc as never);
    const { service, db, audit } = createChatAgentHarness();
    const chatSessionId = uniqueChatSessionId('cherrydb-happy');

    queueStreamPrelude(db, {
      session: createSessionRow({ id: chatSessionId }),
      space: createSpaceRow({
        database_config: {
          enabled: true,
          dsn: 'postgresql://readonly:secret@db.internal:5432/analytics',
          allowed_tables: ['orders', 'customers'],
          masked_columns: ['customers.email'],
        },
      }),
    });
    queueAssistantMessage(db, { id: 'assistant-db-answer', session_id: chatSessionId });

    const iterable = await service.streamCompletion({
      tenantId: TEST_TENANT_ID,
      spaceId: TEST_SPACE_ID,
      userId: TEST_USER_ID,
      userGroupIds: [TEST_GROUP_ID],
      message: 'show orders by month as a chart',
      enableDatabase: true,
    });
    const eventsPromise = collectEvents(iterable);
    await waitForSpawn(1);

    writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: 'db-session' });
    await vi.waitFor(() => expect(stdinChunks.join('')).toContain('show orders by month as a chart'));
    writeJsonLine(proc, {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tables', name: 'Bash', input: { command: 'cherrydb tables' } },
          {
            type: 'tool_use',
            id: 'query',
            name: 'Bash',
            input: { command: 'cherrydb query "select month, total from orders_by_month"' },
          },
          {
            type: 'tool_use',
            id: 'chart',
            name: 'Bash',
            input: { command: 'cherrydb chart bar "select month, total from orders_by_month"' },
          },
          { type: 'text', text: 'Orders increased in March.' },
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
              echarts_option: { xAxis: { data: ['Jan', 'Mar'] }, series: [{ data: [10, 30] }] },
            }),
          },
        ],
      },
    });
    proc.stderr.write(
      `${JSON.stringify({
        event: 'database_query',
        sql: 'select month, total from orders_by_month',
        row_count: 2,
        duration_ms: 12,
        timestamp: '2026-05-05T12:00:00.000Z',
      })}\n`,
    );
    writeJsonLine(proc, {
      type: 'result',
      subtype: 'success',
      session_id: 'db-session',
      usage: { input_tokens: 30, output_tokens: 11 },
    });

    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toEqual([
      'session',
      'agent.tool_use',
      'agent.tool_use',
      'agent.tool_use',
      'content',
      'chart.data',
      'usage',
      'message.completed',
    ]);
    expect(events.find((event) => event.type === 'chart.data')).toMatchObject({
      type: 'chart.data',
      data: { type: 'cherrywiki.chart', chart_type: 'bar' },
    });

    const spawnEnv = spawnMock.mock.calls[0]?.[2]?.env as NodeJS.ProcessEnv | undefined;
    expect(spawnEnv).toMatchObject({
      CHERRY_DB_DSN: 'postgresql://readonly:secret@db.internal:5432/analytics',
      CHERRY_DB_ALLOWED_TABLES: 'orders,customers',
      CHERRY_DB_MASKED_COLUMNS: 'customers.email',
    });

    const databaseAudit = audit.push.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry.action === 'database_query');
    expect(databaseAudit).toMatchObject({
      tenant_id: TEST_TENANT_ID,
      actor_user_id: TEST_USER_ID,
      action: 'database_query',
      resource_type: 'sql',
      space_id: TEST_SPACE_ID,
      metadata_json: expect.objectContaining({
        sql: 'select month, total from orders_by_month',
        row_count: 2,
        duration_ms: 12,
        conversation_id: chatSessionId,
      }),
    });
    proc.close(0);
  });

  it('surfaces cherrydb execution failures as chat errors without chart SSE', async () => {
    const proc = createMockProcess();
    const stdinChunks = captureStdin(proc);
    spawnMock.mockReturnValue(proc as never);
    const { service, db, audit } = createChatAgentHarness();
    const chatSessionId = uniqueChatSessionId('cherrydb-error');

    queueStreamPrelude(db, {
      session: createSessionRow({ id: chatSessionId }),
      space: createSpaceRow({
        database_config: {
          enabled: true,
          dsn: 'postgresql://readonly:secret@db.internal:5432/analytics',
          allowed_tables: ['orders'],
        },
      }),
    });

    const iterable = await service.streamCompletion({
      tenantId: TEST_TENANT_ID,
      spaceId: TEST_SPACE_ID,
      userId: TEST_USER_ID,
      userGroupIds: [TEST_GROUP_ID],
      message: 'delete old orders',
      enableDatabase: true,
    });
    const eventsPromise = collectEvents(iterable);
    await waitForSpawn(1);

    writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: 'db-error-session' });
    await vi.waitFor(() => expect(stdinChunks.join('')).toContain('delete old orders'));
    writeJsonLine(proc, {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'bad-query', name: 'Bash', input: { command: 'cherrydb query "delete from orders"' } },
        ],
      },
    });
    writeJsonLine(proc, {
      type: 'result',
      subtype: 'error_during_execution',
      error: 'cherrydb rejected non-readonly SQL',
    });

    const events = await eventsPromise;
    expect(events).toEqual([
      { type: 'session', session_id: chatSessionId },
      { type: 'agent.tool_use', id: 'bad-query', name: 'Bash', input: { command: 'cherrydb query "delete from orders"' } },
      { type: 'error', code: 'error_during_execution', message: 'cherrydb rejected non-readonly SQL' },
    ]);
    expect(audit.push.mock.calls.some(([entry]) => entry.action === 'database_query')).toBe(false);
    proc.close(0);
  });
});

function createChatAgentHarness(): {
  service: ChatService;
  db: ScriptedChatDb;
  audit: { push: ReturnType<typeof vi.fn<(entry: AuditEntry) => void>> };
} {
  const db = new ScriptedChatDb();
  const audit = { push: vi.fn<(entry: AuditEntry) => void>() };
  const agentService = createRealAgentService({ db, audit: audit as unknown as AuditService, managers });
  const chatProvider = new ScriptedChatProvider([]);
  const embeddingProvider = new ScriptedEmbeddingProvider();
  const service = new ChatService(
    db.asDrizzle(),
    audit as unknown as AuditService,
    () => chatProvider,
    () => embeddingProvider,
    agentService,
  );

  return { service, db, audit };
}

async function waitForSpawn(count: number): Promise<void> {
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(count));
}

function uniqueChatSessionId(prefix: string): string {
  return `${prefix}-${process.pid}-${randomUUID()}`;
}

function captureStdin(proc: ReturnType<typeof createMockProcess>): string[] {
  const chunks: string[] = [];
  proc.stdin.on('data', (chunk: Buffer | string) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  });
  return chunks;
}
