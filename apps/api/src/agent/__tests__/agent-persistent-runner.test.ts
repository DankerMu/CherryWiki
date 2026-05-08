import 'reflect-metadata';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import type { AuditService } from '../../audit/audit.service.js';
import type { DrizzleDatabase } from '../../database/drizzle.module.js';
import { AgentService } from '../agent.service.js';
import { AuditCapture } from '../audit-capture.js';
import { ClaudeMdGenerator } from '../claude-md-generator.js';
import type { PersistentAgentSession } from '../dto/agent.dto.js';
import { SessionManager } from '../session-manager.js';
import { SettingsGenerator } from '../settings-generator.js';
import { StreamParser } from '../stream-parser.js';
import { AgentTestDb, collectAsync, createMockProcess, type MockAgentProcess, writeJsonLine } from './agent-test-utils.js';

const spawnMock = vi.mocked(spawn);
const managers: SessionManager[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  await Promise.all(managers.splice(0).map((manager) => manager.onModuleDestroy()));
});

describe('AgentService persistent runner', () => {
  it('spawns Claude with stream-json pipe args and no CLI prompt', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const { service, manager } = createService();
    const session = await createSession(manager, { maxBudgetUsd: 3 });

    const spawnPromise = service.spawnPersistentProcess(session);
    await waitForSpawn();
    writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: 'provider-args' });
    await spawnPromise;

    const args = spawnMock.mock.calls[0]?.[1];
    expect(args).toEqual(
      expect.arrayContaining([
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--tools',
        'Bash,Read',
        '--permission-mode',
        'bypassPermissions',
        '--max-budget-usd',
        '3',
      ]),
    );
    expect(args).toEqual(expect.arrayContaining(['--settings', `${session.workDir}/settings.json`]));
    expect(args).not.toContain('--print');
    expect(args).not.toContain('hello from cli');

    proc.close(0);
  });

  it('uses --session-id for first spawn and --resume with providerSessionId for resume', async () => {
    const first = createMockProcess();
    const resumed = createMockProcess();
    spawnMock.mockReturnValueOnce(first as never).mockReturnValueOnce(resumed as never);
    const { service, manager } = createService();
    const session = await createSession(manager);

    const firstSpawn = service.spawnPersistentProcess(session);
    await waitForSpawn(1);
    writeJsonLine(first, { type: 'system', subtype: 'init', session_id: 'provider-resume' });
    await firstSpawn;
    first.close(0);
    await vi.waitFor(() => expect(service.getActiveAgentCount()).toBe(0));

    const secondSpawn = service.spawnPersistentProcess(session);
    await waitForSpawn(2);
    writeJsonLine(resumed, { type: 'system', subtype: 'init', session_id: 'provider-resume' });
    await secondSpawn;

    expect(spawnMock.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['--session-id', session.sessionId]));
    expect(spawnMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(['--resume', 'provider-resume']));

    resumed.close(0);
  });

  it('writes each turn to stdin as a stream-json user line', async () => {
    const proc = createMockProcess();
    const stdinChunks = captureStdin(proc);
    spawnMock.mockReturnValue(proc as never);
    const { service, manager } = createService();
    const session = await createStartedSession(service, manager, proc, 'provider-stdin');

    const eventsPromise = collectAsync(service.sendTurnToPersistentProcess(session, 'hello "json"'));
    await vi.waitFor(() => expect(stdinChunks.join('')).toContain('\n'));
    writeJsonLine(proc, { type: 'result', subtype: 'success', session_id: 'provider-stdin' });
    await eventsPromise;

    expect(stdinChunks.join('')).toBe(
      `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello "json"' } })}\n`,
    );

    proc.close(0);
  });

  it('captures system/init provider session id into SessionManager metadata', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const { service, manager } = createService();
    const session = await createSession(manager);

    const spawnPromise = service.spawnPersistentProcess(session);
    await waitForSpawn();
    writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: 'provider-captured' });
    await spawnPromise;

    const saved = await manager.getOrCreateSession(session.conversationId, session.spaceId, session.tenantId, session.userId);
    expect(saved.providerSessionId).toBe('provider-captured');
    expect(session.providerSessionId).toBe('provider-captured');

    proc.close(0);
  });

  it('marks result success as idle while keeping the process and slot alive', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const { service, manager } = createService();
    const session = await createStartedSession(service, manager, proc, 'provider-success', {
      maxConcurrentAgents: 1,
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    const eventsPromise = collectAsync(service.sendTurnToPersistentProcess(session, 'finish successfully'));
    writeJsonLine(proc, { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } });
    writeJsonLine(proc, {
      type: 'result',
      subtype: 'success',
      session_id: 'provider-success',
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    const events = await eventsPromise;
    const saved = await manager.getOrCreateSession(session.conversationId, session.spaceId, session.tenantId, session.userId);

    expect(events.map((event) => event.type)).toEqual(['message.delta', 'message.completed']);
    expect(saved.status).toBe('idle');
    expect(saved.child).toBe(proc);
    expect(proc.exitCode).toBeNull();
    expect(service.getActiveAgentCount()).toBe(1);

    proc.close(0);
    await vi.waitFor(() => expect(service.getActiveAgentCount()).toBe(0));
  });

  it('marks result error as the end of the current turn and returns the live process to idle', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const { service, manager } = createService();
    const session = await createStartedSession(service, manager, proc, 'provider-error');

    const eventsPromise = collectAsync(service.sendTurnToPersistentProcess(session, 'fail this turn'));
    writeJsonLine(proc, {
      type: 'result',
      subtype: 'error_during_execution',
      error: 'tool failed',
    });
    const events = await eventsPromise;
    const saved = await manager.getOrCreateSession(session.conversationId, session.spaceId, session.tenantId, session.userId);

    expect(events).toEqual([{ type: 'message.error', code: 'error_during_execution', message: 'tool failed' }]);
    expect(saved.status).toBe('idle');
    expect(saved.child).toBe(proc);

    proc.close(0);
  });

  it('marks a non-zero process exit as failed and releases the process slot', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const { service, manager } = createService();
    const session = await createStartedSession(service, manager, proc, 'provider-exit', { maxConcurrentAgents: 1 });

    expect(service.getActiveAgentCount()).toBe(1);
    proc.close(1);

    await vi.waitFor(async () => {
      const saved = await manager.getOrCreateSession(session.conversationId, session.spaceId, session.tenantId, session.userId);
      expect(saved.status).toBe('failed');
    });
    expect(service.getActiveAgentCount()).toBe(0);
  });

  it('keeps stderr audit capture active for the lifetime of the persistent process', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const { service, manager, auditPush } = createService();
    const session = await createStartedSession(service, manager, proc, 'provider-audit', {
      tenantId: 'tenant-audit',
      userId: 'user-audit',
    });

    proc.stderr.write(`${JSON.stringify({ event: 'database_query', sql: 'select 1' })}\n`);
    const eventsPromise = collectAsync(service.sendTurnToPersistentProcess(session, 'audit turn'));
    writeJsonLine(proc, { type: 'result', subtype: 'success', session_id: 'provider-audit' });
    await eventsPromise;
    proc.stderr.write(`${JSON.stringify({ event: 'database_query', sql: 'select 2' })}\n`);
    await vi.waitFor(() => expect(auditPush).toHaveBeenCalledTimes(2));

    expect(auditPush).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-audit',
        actor_user_id: 'user-audit',
        action: 'database_query',
        metadata_json: expect.objectContaining({ conversation_id: session.conversationId, sql: 'select 2' }) as object,
      }),
    );

    proc.close(0);
  });
});

function createService(): {
  service: AgentService;
  manager: SessionManager;
  db: AgentTestDb;
  auditPush: ReturnType<typeof vi.fn>;
} {
  const db = new AgentTestDb();
  const manager = new SessionManager();
  manager.configureForTests({ sigintGraceMs: 1, idleTimeoutMs: 60_000 });
  managers.push(manager);
  const auditPush = vi.fn();
  const auditService = { push: auditPush } as unknown as AuditService;
  const service = new AgentService(
    db as unknown as DrizzleDatabase,
    manager,
    new StreamParser(),
    new AuditCapture(auditService),
    new ClaudeMdGenerator(),
    new SettingsGenerator(),
  );

  return { service, manager, db, auditPush };
}

async function createSession(
  manager: SessionManager,
  options: PersistentAgentSession['options'] = {},
): Promise<PersistentAgentSession> {
  const conversationId = `conversation-persistent-${randomUUID()}`;
  return manager.getOrCreateSession(conversationId, 'space-1', 'tenant-1', 'user-1', {
    tenantId: 'tenant-1',
    userId: 'user-1',
    ...options,
  });
}

async function createStartedSession(
  service: AgentService,
  manager: SessionManager,
  proc: MockAgentProcess,
  providerSessionId: string,
  options: PersistentAgentSession['options'] = {},
): Promise<PersistentAgentSession> {
  const session = await createSession(manager, options);
  const spawnPromise = service.spawnPersistentProcess(session);
  await waitForSpawn();
  writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: providerSessionId });
  await spawnPromise;
  return session;
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
