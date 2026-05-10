import 'reflect-metadata';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import type { AuditService } from '../../audit/audit.service.js';
import type { DrizzleDatabase } from '../../database/drizzle.module.js';
import { AgentService, AgentSessionBusyError } from '../agent.service.js';
import { AuditCapture } from '../audit-capture.js';
import { ClaudeMdGenerator } from '../claude-md-generator.js';
import type { PersistentAgentSession } from '../dto/agent.dto.js';
import { SessionManager } from '../session-manager.js';
import { SettingsGenerator } from '../settings-generator.js';
import { StreamParser } from '../stream-parser.js';
import {
  AgentTestDb,
  collectAsync,
  createMockProcess,
  type MockAgentProcess,
  writeJsonLine,
} from './agent-test-utils.js';

const spawnMock = vi.mocked(spawn);
const managers: SessionManager[] = [];
const originalSigintGraceMs = process.env.AGENT_SIGINT_GRACE_MS;

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  if (originalSigintGraceMs === undefined) {
    delete process.env.AGENT_SIGINT_GRACE_MS;
  } else {
    process.env.AGENT_SIGINT_GRACE_MS = originalSigintGraceMs;
  }
  await Promise.all(managers.splice(0).map((manager) => manager.onModuleDestroy()));
});

describe('AgentService sendTurn dispatch', () => {
  it('AgentSessionBusyError carries the expected name and message', () => {
    const error = new AgentSessionBusyError('conversation-busy');

    expect(error.name).toBe('AgentSessionBusyError');
    expect(error.message).toBe('Agent session conversation-busy is busy with another turn');
  });

  it('spawns a persistent process when no live process exists and yields stable SSE events', async () => {
    const proc = createMockProcess();
    const stdinChunks = captureStdin(proc);
    spawnMock.mockReturnValue(proc as never);
    const { service } = createService();
    const conversationId = uniqueConversationId();

    const eventsPromise = collectAsync(
      service.sendTurn(conversationId, 'space-1', 'hello persistent runtime', {
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    );

    await waitForSpawn();
    writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: 'provider-new' });
    await vi.waitFor(() => expect(stdinChunks.join('')).toContain('hello persistent runtime'));
    writeJsonLine(proc, {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'graphify query SSO' } },
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
              echarts_option: { xAxis: {}, series: [] },
            }),
          },
        ],
      },
    });
    writeJsonLine(proc, {
      type: 'result',
      subtype: 'success',
      session_id: 'provider-new',
      result: 'hello',
      usage: { input_tokens: 3, output_tokens: 4 },
    });

    const events = await eventsPromise;

    expect(events).toMatchObject([
      { type: 'message.delta', delta: 'hello' },
      { type: 'agent.tool_use', id: 'tool-1', name: 'Bash', input: { command: 'graphify query SSO' } },
      {
        type: 'chart.data',
        chart_type: 'bar',
        data: { type: 'cherrywiki.chart', chart_type: 'bar' },
      },
      {
        type: 'message.completed',
        session_id: 'provider-new',
        result: 'hello',
        usage: { input_tokens: 3, output_tokens: 4 },
      },
    ]);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    proc.close(0);
  });

  it('reuses an existing idle process for a later turn', async () => {
    const proc = createMockProcess();
    const stdinChunks = captureStdin(proc);
    spawnMock.mockReturnValue(proc as never);
    const { service, manager } = createService();
    const session = await createStartedSession(service, manager, proc, 'provider-reuse');
    await manager.markIdle(session.conversationId);

    const eventsPromise = collectAsync(
      service.sendTurn(session.conversationId, session.spaceId, 'second turn', {
        tenantId: session.tenantId,
        userId: session.userId,
      }),
    );

    await vi.waitFor(() => expect(stdinChunks.join('')).toContain('second turn'));
    writeJsonLine(proc, { type: 'result', subtype: 'success', session_id: 'provider-reuse' });
    await expect(eventsPromise).resolves.toMatchObject([{ type: 'message.completed' }]);

    expect(spawnMock).toHaveBeenCalledTimes(1);

    proc.close(0);
  });

  it('rejects a concurrent turn for the same conversation and releases the mutex after completion', async () => {
    const proc = createMockProcess();
    const stdinChunks = captureStdin(proc);
    spawnMock.mockReturnValue(proc as never);
    const { service } = createService();
    const conversationId = uniqueConversationId();

    const firstTurn = collectAsync(
      service.sendTurn(conversationId, 'space-1', 'first turn', {
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    );
    await waitForSpawn();
    writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: 'provider-busy' });
    await vi.waitFor(() => expect(stdinChunks.join('')).toContain('first turn'));

    await expect(
      collectAsync(
        service.sendTurn(conversationId, 'space-1', 'second turn', {
          tenantId: 'tenant-1',
          userId: 'user-1',
        }),
      ),
    ).rejects.toBeInstanceOf(AgentSessionBusyError);

    writeJsonLine(proc, { type: 'result', subtype: 'success', session_id: 'provider-busy' });
    await firstTurn;

    const thirdTurn = collectAsync(
      service.sendTurn(conversationId, 'space-1', 'third turn', {
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    );
    await vi.waitFor(() => expect(stdinChunks.join('')).toContain('third turn'));
    writeJsonLine(proc, { type: 'result', subtype: 'success', session_id: 'provider-busy' });
    await expect(thirdTurn).resolves.toMatchObject([{ type: 'message.completed' }]);

    proc.close(0);
  });

  it('does not spawn when the conversation is owned by another tenant or user', async () => {
    const { service, manager } = createService();
    const conversationId = uniqueConversationId();
    await manager.getOrCreateSession(conversationId, 'space-1', 'tenant-a', 'user-a', {
      tenantId: 'tenant-a',
      userId: 'user-a',
    });

    const events = await collectAsync(
      service.sendTurn(conversationId, 'space-2', 'cross-scope turn', {
        tenantId: 'tenant-b',
        userId: 'user-b',
      }),
    );

    expect(events).toEqual([
      {
        type: 'message.error',
        code: 'agent_session_scope_mismatch',
        message: 'Agent session is not available for this tenant or user',
      },
    ]);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('sends SIGINT on SSE disconnect and keeps the process alive if Claude returns to idle', async () => {
    const proc = createMockProcess();
    const stdinChunks = captureStdin(proc);
    spawnMock.mockReturnValue(proc as never);
    const { service, manager } = createService();
    const conversationId = uniqueConversationId();
    const iterator = service.sendTurn(conversationId, 'space-1', 'long turn', {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    const firstEvent = iterator.next();
    await waitForSpawn();
    writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: 'provider-cancel' });
    await vi.waitFor(() => expect(stdinChunks.join('')).toContain('long turn'));
    writeJsonLine(proc, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'partial' }] },
    });
    await expect(firstEvent).resolves.toEqual({
      done: false,
      value: { type: 'message.delta', delta: 'partial' },
    });

    const returnPromise = iterator.return(undefined);
    await vi.waitFor(() => expect(proc.kill).toHaveBeenCalledWith('SIGINT'));
    writeJsonLine(proc, { type: 'result', subtype: 'success', session_id: 'provider-cancel' });
    await returnPromise;

    const saved = expectDefined(
      await manager.getOrCreateSession(conversationId, 'space-1', 'tenant-1', 'user-1'),
    );
    expect(saved.status).toBe('idle');
    expect(saved.child).toBe(proc);
    expect(proc.kill).not.toHaveBeenCalledWith('SIGKILL');

    proc.close(0);
  });

  it('escalates SSE disconnect cancellation to SIGKILL after the SIGINT grace timeout', async () => {
    process.env.AGENT_SIGINT_GRACE_MS = '1';
    const proc = createMockProcess();
    const stdinChunks = captureStdin(proc);
    spawnMock.mockReturnValue(proc as never);
    const { service, manager } = createService();
    const conversationId = uniqueConversationId();
    const iterator = service.sendTurn(conversationId, 'space-1', 'stuck turn', {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    const firstEvent = iterator.next();
    await waitForSpawn();
    writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: 'provider-sigkill' });
    await vi.waitFor(() => expect(stdinChunks.join('')).toContain('stuck turn'));
    writeJsonLine(proc, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'partial' }] },
    });
    await expect(firstEvent).resolves.toEqual({
      done: false,
      value: { type: 'message.delta', delta: 'partial' },
    });

    await iterator.return(undefined);

    expect(proc.kill).toHaveBeenCalledWith('SIGINT');
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    const saved = expectDefined(
      await manager.getOrCreateSession(conversationId, 'space-1', 'tenant-1', 'user-1'),
    );
    expect(saved.status).toBe('failed');
  });
});

function createService(): {
  service: AgentService;
  manager: SessionManager;
} {
  const db = new AgentTestDb();
  const manager = new SessionManager();
  manager.configureForTests({ sigintGraceMs: 1, idleTimeoutMs: 60_000 });
  managers.push(manager);
  const auditService = { push: vi.fn() } as unknown as AuditService;
  const service = new AgentService(
    db as unknown as DrizzleDatabase,
    manager,
    new StreamParser(),
    new AuditCapture(auditService),
    new ClaudeMdGenerator(),
    new SettingsGenerator(),
  );

  return { service, manager };
}

async function createStartedSession(
  service: AgentService,
  manager: SessionManager,
  proc: MockAgentProcess,
  providerSessionId: string,
): Promise<PersistentAgentSession> {
  const session = expectDefined(
    await manager.getOrCreateSession(uniqueConversationId(), 'space-1', 'tenant-1', 'user-1', {
      tenantId: 'tenant-1',
      userId: 'user-1',
    }),
  );
  await service.spawnPersistentProcess(session);
  writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: providerSessionId });
  await vi.waitFor(() => expect(session.providerSessionId).toBe(providerSessionId));
  return session;
}

function expectDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

function captureStdin(proc: MockAgentProcess): string[] {
  const chunks: string[] = [];
  proc.stdin.on('data', (chunk: Buffer | string) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  });
  return chunks;
}

async function waitForSpawn(count = 1): Promise<void> {
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(count));
}

function uniqueConversationId(): string {
  return `conversation-turn-${randomUUID()}`;
}
