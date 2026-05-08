import 'reflect-metadata';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

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
const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  await Promise.all(managers.splice(0).map((manager) => manager.onModuleDestroy()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('AgentService config refresh and persistent resume', () => {
  it('refreshes CLAUDE.md and settings.json before each turn without restarting when the fingerprint is stable', async () => {
    const proc = createMockProcess();
    const stdinChunks = captureStdin(proc);
    spawnMock.mockReturnValue(proc as never);
    const { service, claudeMdGenerate, settingsGenerate } = await createService();
    const conversationId = uniqueConversationId();

    const firstTurn = collectAsync(
      service.sendTurn(conversationId, 'space-1', 'first turn', {
        tenantId: 'tenant-1',
        userId: 'user-1',
        allowedSpaces: [{ id: 'space-1', name: 'Knowledge' }],
      }),
    );
    await waitForSpawn(1);
    writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: 'provider-refresh-stable' });
    await vi.waitFor(() => expect(stdinChunks.join('')).toContain('first turn'));
    writeJsonLine(proc, { type: 'result', subtype: 'success', session_id: 'provider-refresh-stable' });
    await firstTurn;

    const session = service.getSession(conversationId);
    expect(session).toBeDefined();
    await writeFile(join(session?.workDir ?? '', 'CLAUDE.md'), 'stale runtime file\n', 'utf8');

    const secondTurn = collectAsync(
      service.sendTurn(conversationId, 'space-1', 'second turn', {
        tenantId: 'tenant-1',
        userId: 'user-1',
        allowedSpaces: [{ id: 'space-1', name: 'Knowledge' }],
      }),
    );
    await vi.waitFor(() => expect(stdinChunks.join('')).toContain('second turn'));
    writeJsonLine(proc, { type: 'result', subtype: 'success', session_id: 'provider-refresh-stable' });
    await secondTurn;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(claudeMdGenerate).toHaveBeenCalledTimes(3);
    expect(settingsGenerate).toHaveBeenCalledTimes(3);
    await expect(readFile(join(session?.workDir ?? '', 'CLAUDE.md'), 'utf8')).resolves.toContain('CherryWiki Agent');

    proc.close(0);
  });

  it('restarts an idle process with --resume when the options fingerprint changes and injects database env', async () => {
    const first = createClosingOnKillProcess();
    const firstStdin = captureStdin(first);
    const resumed = createMockProcess();
    const resumedStdin = captureStdin(resumed);
    spawnMock.mockReturnValueOnce(first as never).mockReturnValueOnce(resumed as never);
    const { service } = await createService();
    const conversationId = uniqueConversationId();

    const firstTurn = collectAsync(
      service.sendTurn(conversationId, 'space-1', 'database off', {
        tenantId: 'tenant-1',
        userId: 'user-1',
        enableDatabase: false,
      }),
    );
    await waitForSpawn(1);
    writeJsonLine(first, { type: 'system', subtype: 'init', session_id: 'provider-db-toggle' });
    await vi.waitFor(() => expect(firstStdin.join('')).toContain('database off'));
    writeJsonLine(first, { type: 'result', subtype: 'success', session_id: 'provider-db-toggle' });
    await firstTurn;

    const secondTurn = collectAsync(
      service.sendTurn(conversationId, 'space-1', 'database on', {
        tenantId: 'tenant-1',
        userId: 'user-1',
        enableDatabase: true,
        databaseConfig: {
          enabled: true,
          dsn: 'postgresql://readonly:secret@db.internal:5432/analytics',
          allowed_tables: ['orders'],
          masked_columns: ['orders.customer_email'],
        },
      }),
    );
    await waitForSpawn(2);
    writeJsonLine(resumed, { type: 'system', subtype: 'init', session_id: 'provider-db-toggle' });
    await vi.waitFor(() => expect(resumedStdin.join('')).toContain('database on'));
    writeJsonLine(resumed, { type: 'result', subtype: 'success', session_id: 'provider-db-toggle' });
    await secondTurn;

    expect(first.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawnMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(['--resume', 'provider-db-toggle']));
    expect(spawnMock.mock.calls[1]?.[2]?.env).toMatchObject({
      CHERRY_DB_DSN: 'postgresql://readonly:secret@db.internal:5432/analytics',
      CHERRY_DB_ALLOWED_TABLES: 'orders',
      CHERRY_DB_MASKED_COLUMNS: 'orders.customer_email',
    });

    resumed.close(0);
  });

  it('spawns --resume when an idle-killed session has provider metadata but no live process', async () => {
    const first = createClosingOnKillProcess();
    const firstStdin = captureStdin(first);
    const resumed = createMockProcess();
    const resumedStdin = captureStdin(resumed);
    spawnMock.mockReturnValueOnce(first as never).mockReturnValueOnce(resumed as never);
    const { service, manager } = await createService({ idleTimeoutMs: 1 });
    const conversationId = uniqueConversationId();

    const firstTurn = collectAsync(
      service.sendTurn(conversationId, 'space-1', 'before idle kill', {
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    );
    await waitForSpawn(1);
    writeJsonLine(first, { type: 'system', subtype: 'init', session_id: 'provider-idle-killed' });
    await vi.waitFor(() => expect(firstStdin.join('')).toContain('before idle kill'));
    writeJsonLine(first, { type: 'result', subtype: 'success', session_id: 'provider-idle-killed' });
    await firstTurn;

    await manager.sweepIdleSessions(Date.now() + 1_000);

    const secondTurn = collectAsync(
      service.sendTurn(conversationId, 'space-1', 'after idle kill', {
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    );
    await waitForSpawn(2);
    writeJsonLine(resumed, { type: 'system', subtype: 'init', session_id: 'provider-idle-killed' });
    await vi.waitFor(() => expect(resumedStdin.join('')).toContain('after idle kill'));
    writeJsonLine(resumed, { type: 'result', subtype: 'success', session_id: 'provider-idle-killed' });
    await secondTurn;

    expect(first.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawnMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(['--resume', 'provider-idle-killed']));

    resumed.close(0);
  });

  it('renames a failed resume workDir and falls back to a fresh session-id spawn', async () => {
    const failedResume = createMockProcess();
    const fresh = createMockProcess();
    spawnMock.mockReturnValueOnce(failedResume as never).mockReturnValueOnce(fresh as never);
    const { service, manager } = await createService();
    const session = await createPersistentSession(manager);
    manager.setSessionId(session.conversationId, 'provider-broken');
    session.providerSessionId = 'provider-broken';
    await writeFile(join(session.workDir, 'resume-marker.txt'), 'old workdir\n', 'utf8');

    const spawnPromise = service.spawnPersistentProcess(session);
    await waitForSpawn(1);
    failedResume.close(1);
    await waitForSpawn(2);
    writeJsonLine(fresh, { type: 'system', subtype: 'init', session_id: 'provider-fresh' });
    await spawnPromise;

    const failedDirs = await findFailedSiblingDirs(session.workDir);
    expect(failedDirs).toHaveLength(1);
    await expect(stat(join(failedDirs[0] ?? '', 'resume-marker.txt'))).resolves.toBeTruthy();
    await expect(stat(session.workDir)).resolves.toBeTruthy();
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['--resume', 'provider-broken']));
    expect(spawnMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(['--session-id', session.sessionId]));
    expect(spawnMock.mock.calls[1]?.[1]).not.toContain('--resume');

    const saved = await manager.getOrCreateSession(session.conversationId, session.spaceId, session.tenantId, session.userId);
    expect(saved.providerSessionId).toBe('provider-fresh');
    expect(saved.workDir).toBe(session.workDir);

    fresh.close(0);
  });
});

async function createService(config: { idleTimeoutMs?: number } = {}): Promise<{
  service: AgentService;
  manager: SessionManager;
  claudeMdGenerate: MockInstance<ClaudeMdGenerator['generate']>;
  settingsGenerate: MockInstance<SettingsGenerator['generate']>;
}> {
  const agentRoot = await createTempDir('agent-config-refresh-root');
  const manager = new SessionManager(undefined, {
    agentRoot,
    sigintGraceMs: 1,
    idleTimeoutMs: config.idleTimeoutMs ?? 60_000,
  });
  managers.push(manager);
  const auditService = { push: vi.fn() } as unknown as AuditService;
  const claudeMdGenerator = new ClaudeMdGenerator();
  const settingsGenerator = new SettingsGenerator();
  const claudeMdGenerate = vi.spyOn(claudeMdGenerator, 'generate');
  const settingsGenerate = vi.spyOn(settingsGenerator, 'generate');
  const service = new AgentService(
    new AgentTestDb() as unknown as DrizzleDatabase,
    manager,
    new StreamParser(),
    new AuditCapture(auditService),
    claudeMdGenerator,
    settingsGenerator,
  );

  return { service, manager, claudeMdGenerate, settingsGenerate };
}

async function createPersistentSession(manager: SessionManager): Promise<PersistentAgentSession> {
  return manager.getOrCreateSession(uniqueConversationId(), 'space-1', 'tenant-1', 'user-1', {
    tenantId: 'tenant-1',
    userId: 'user-1',
  });
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

async function findFailedSiblingDirs(workDir: string): Promise<string[]> {
  const parent = dirname(workDir);
  const prefix = `${basename(workDir)}.failed.`;
  const entries = await readdir(parent, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => join(parent, entry.name));
}

function uniqueConversationId(): string {
  return `conversation-config-${randomUUID()}`;
}
