import 'reflect-metadata';

import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import type {
  AgentSessionRepository,
  AgentSessionRow,
  NewAgentSession,
} from '../agent-session.repository.js';
import { SessionManager, type SessionManagerConfig } from '../session-manager.js';
import type { AgentSpawnOptions } from '../dto/agent.dto.js';
import { createMockProcess } from './agent-test-utils.js';

const managers: SessionManager[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.onModuleDestroy()));
  vi.useRealTimers();
  vi.clearAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('SessionManager', () => {
  it('creates a fresh persistent session when neither memory nor DB has one', async () => {
    const repository = createRepository();
    const manager = await createManager(repository.instance);

    const session = await manager.getOrCreateSession(
      'conversation-fresh',
      'space-1',
      'tenant-1',
      'user-1',
      { allowedSpaces: [{ id: 'space-1', graphPath: '/graphs/space-1' }], model: 'sonnet' },
    );

    expect(session).toMatchObject({
      conversationId: 'conversation-fresh',
      tenantId: 'tenant-1',
      spaceId: 'space-1',
      userId: 'user-1',
      providerSessionId: undefined,
      status: 'starting',
      ownedByInstance: 'instance-local',
    });
    expect(session.optionsFingerprint).toHaveLength(64);
    expect(repository.findByConversationScope).toHaveBeenCalledWith(
      'conversation-fresh',
      'tenant-1',
      'user-1',
    );
    expect(repository.findByConversationId).not.toHaveBeenCalled();
    expect(repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conversation-fresh',
        status: 'starting',
        provider_session_id: null,
        owned_by_instance: 'instance-local',
      }),
    );
    await expect(stat(session.workDir)).resolves.toBeTruthy();
    await expect(stat(session.agentHome)).resolves.toBeTruthy();
  });

  it('getOrCreateSession restores persisted session when tenant and user match', async () => {
    const row = createAgentSessionRow({
      conversation_id: 'conversation-restore',
      provider_session_id: 'claude-session-restore',
      status: 'idle',
      owned_by_instance: 'instance-local',
      work_dir: await createWorkDir('restore'),
    });
    row.agent_home = join(row.work_dir, '.home');
    const repository = createRepository([row]);
    const manager = await createManager(repository.instance);

    const session = await manager.getOrCreateSession(
      'conversation-restore',
      'ignored-space',
      row.tenant_id,
      row.user_id,
      {},
    );

    expect(repository.findByConversationScope).toHaveBeenCalledWith(
      'conversation-restore',
      row.tenant_id,
      row.user_id,
    );
    expect(repository.findByConversationId).not.toHaveBeenCalled();
    expect(session).toMatchObject({
      conversationId: 'conversation-restore',
      tenantId: row.tenant_id,
      spaceId: row.space_id,
      userId: row.user_id,
      providerSessionId: 'claude-session-restore',
      status: 'stopped',
      child: undefined,
      ownedByInstance: 'instance-local',
    });
    expect(manager.size()).toBe(1);
    expect(repository.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversation_id: 'conversation-restore',
        status: 'stopped',
        provider_session_id: 'claude-session-restore',
        owned_by_instance: 'instance-local',
      }),
    );
  });

  it('getOrCreateSession creates fresh session when persisted row has wrong tenant', async () => {
    const row = createAgentSessionRow({
      conversation_id: 'conversation-wrong-tenant',
      tenant_id: 'tenant-original',
      user_id: 'user-1',
      provider_session_id: 'claude-session-original',
      status: 'idle',
      work_dir: await createWorkDir('wrong-tenant'),
    });
    row.agent_home = join(row.work_dir, '.home');
    const repository = createRepository([row]);
    const manager = await createManager(repository.instance);

    const session = await manager.getOrCreateSession(
      'conversation-wrong-tenant',
      'space-request',
      'tenant-request',
      'user-1',
      {},
    );

    expect(repository.findByConversationScope).toHaveBeenCalledWith(
      'conversation-wrong-tenant',
      'tenant-request',
      'user-1',
    );
    expect(repository.findByConversationId).not.toHaveBeenCalled();
    expect(session).toMatchObject({
      conversationId: 'conversation-wrong-tenant',
      tenantId: 'tenant-request',
      spaceId: 'space-request',
      userId: 'user-1',
      providerSessionId: undefined,
      status: 'starting',
    });
    expect(session.workDir).not.toBe(row.work_dir);
    expect(repository.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversation_id: 'conversation-wrong-tenant',
        tenant_id: 'tenant-request',
        user_id: 'user-1',
        provider_session_id: null,
        status: 'starting',
      }),
    );
    expect(repository.updateStatus).not.toHaveBeenCalled();
    expect(repository.updateProviderSessionId).not.toHaveBeenCalled();
    expect(repository.touchActivity).not.toHaveBeenCalled();
  });

  it('getOrCreateSession creates fresh session when persisted row has wrong user', async () => {
    const row = createAgentSessionRow({
      conversation_id: 'conversation-wrong-user',
      tenant_id: 'tenant-1',
      user_id: 'user-original',
      provider_session_id: 'claude-session-original',
      status: 'idle',
      work_dir: await createWorkDir('wrong-user'),
    });
    row.agent_home = join(row.work_dir, '.home');
    const repository = createRepository([row]);
    const manager = await createManager(repository.instance);

    const session = await manager.getOrCreateSession(
      'conversation-wrong-user',
      'space-request',
      'tenant-1',
      'user-request',
      {},
    );

    expect(repository.findByConversationScope).toHaveBeenCalledWith(
      'conversation-wrong-user',
      'tenant-1',
      'user-request',
    );
    expect(repository.findByConversationId).not.toHaveBeenCalled();
    expect(session).toMatchObject({
      conversationId: 'conversation-wrong-user',
      tenantId: 'tenant-1',
      spaceId: 'space-request',
      userId: 'user-request',
      providerSessionId: undefined,
      status: 'starting',
    });
    expect(session.workDir).not.toBe(row.work_dir);
    expect(repository.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversation_id: 'conversation-wrong-user',
        tenant_id: 'tenant-1',
        user_id: 'user-request',
        provider_session_id: null,
        status: 'starting',
      }),
    );
    expect(repository.updateStatus).not.toHaveBeenCalled();
    expect(repository.updateProviderSessionId).not.toHaveBeenCalled();
    expect(repository.touchActivity).not.toHaveBeenCalled();
  });

  it('marks sessions owned by a different instance as stopped and claims ownership', async () => {
    const row = createAgentSessionRow({
      conversation_id: 'conversation-remote',
      status: 'running',
      owned_by_instance: 'instance-remote',
      work_dir: await createWorkDir('remote'),
    });
    row.agent_home = join(row.work_dir, '.home');
    const repository = createRepository([row]);
    const manager = await createManager(repository.instance);

    const session = await manager.getOrCreateSession(
      'conversation-remote',
      'space-1',
      'tenant-1',
      'user-1',
      {},
    );

    expect(session.status).toBe('stopped');
    expect(session.ownedByInstance).toBe('instance-local');
    expect(repository.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversation_id: 'conversation-remote',
        status: 'stopped',
        owned_by_instance: 'instance-local',
      }),
    );
  });

  it('attachProcess stores the child process and persists running status', async () => {
    const repository = createRepository();
    const manager = await createManager(repository.instance);
    await manager.getOrCreateSession('conversation-attach', 'space-1', 'tenant-1', 'user-1');
    const proc = createClosingProcess();

    await manager.attachProcess('conversation-attach', proc as unknown as ChildProcess);
    const session = await manager.getOrCreateSession('conversation-attach', 'space-1', 'tenant-1', 'user-1');

    expect(session.status).toBe('running');
    expect(session.child).toBe(proc);
    expect(repository.updateStatus).toHaveBeenLastCalledWith(
      'conversation-attach',
      'running',
      expect.objectContaining({
        process_started_at: expect.any(Date) as Date,
        process_stopped_at: null,
      }),
    );
  });

  it('markIdle starts an idle kill timer and persists idle status', async () => {
    const repository = createRepository();
    const manager = await createManager(repository.instance, { idleTimeoutMs: 1_000 });
    await manager.getOrCreateSession('conversation-idle', 'space-1', 'tenant-1', 'user-1');
    await manager.attachProcess('conversation-idle', createClosingProcess() as unknown as ChildProcess);

    await manager.markIdle('conversation-idle');
    const session = await manager.getOrCreateSession('conversation-idle', 'space-1', 'tenant-1', 'user-1');

    expect(session.status).toBe('idle');
    expect(session.idleKillTimer).toBeDefined();
    expect(repository.updateStatus).toHaveBeenLastCalledWith(
      'conversation-idle',
      'idle',
      expect.objectContaining({ last_activity_at: expect.any(Date) as Date }),
    );
  });

  it('markStopped clears process references and idle timers', async () => {
    const repository = createRepository();
    const manager = await createManager(repository.instance, { idleTimeoutMs: 1_000 });
    await manager.getOrCreateSession('conversation-stopped', 'space-1', 'tenant-1', 'user-1');
    const proc = createClosingProcess();
    await manager.attachProcess('conversation-stopped', proc as unknown as ChildProcess);
    await manager.markIdle('conversation-stopped');

    await manager.markStopped('conversation-stopped');
    const session = await manager.getOrCreateSession('conversation-stopped', 'space-1', 'tenant-1', 'user-1');

    expect(session.status).toBe('stopped');
    expect(session.child).toBeUndefined();
    expect(session.idleKillTimer).toBeUndefined();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('touch updates activity time and reschedules idle state persistence', async () => {
    const repository = createRepository();
    const manager = await createManager(repository.instance, { idleTimeoutMs: 10_000 });
    await manager.getOrCreateSession('conversation-touch', 'space-1', 'tenant-1', 'user-1');
    await manager.markIdle('conversation-touch');

    manager.touch('conversation-touch', 12_345);
    const session = await manager.getOrCreateSession('conversation-touch', 'space-1', 'tenant-1', 'user-1');

    expect(session.lastActivityAt).toBe(12_345);
    expect(repository.updateStatus).toHaveBeenLastCalledWith(
      'conversation-touch',
      'idle',
      expect.objectContaining({ last_activity_at: new Date(12_345) }),
    );
  });

  it('close explicitly terminates with SIGTERM, deletes workDir, and removes DB metadata', async () => {
    const repository = createRepository();
    const manager = await createManager(repository.instance);
    const session = await manager.getOrCreateSession('conversation-close', 'space-1', 'tenant-1', 'user-1');
    const proc = createClosingProcess();
    await manager.attachProcess('conversation-close', proc as unknown as ChildProcess);

    await manager.close('conversation-close');

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(repository.delete).toHaveBeenCalledWith('conversation-close');
    expect(manager.hasSession('conversation-close')).toBe(false);
    await expect(stat(session.workDir)).rejects.toThrow();
  });

  it('sweepIdleSessions kills expired idle processes but preserves workDir and DB row', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const repository = createRepository();
    const manager = await createManager(repository.instance, { idleTimeoutMs: 1_000 });
    const session = await manager.getOrCreateSession('conversation-sweep', 'space-1', 'tenant-1', 'user-1');
    const proc = createClosingProcess();
    await manager.attachProcess('conversation-sweep', proc as unknown as ChildProcess);
    await manager.markIdle('conversation-sweep');

    const swept = await manager.sweepIdleSessions(2_000);

    expect(swept).toEqual(['conversation-sweep']);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(repository.delete).not.toHaveBeenCalled();
    await expect(stat(session.workDir)).resolves.toBeTruthy();
  });

  it('lruEvict kills the least-recently-used idle process and never evicts running sessions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const repository = createRepository();
    const manager = await createManager(repository.instance, { maxResidentProcesses: 1 });
    await manager.getOrCreateSession('conversation-old', 'space-1', 'tenant-1', 'user-1');
    const oldProc = createClosingProcess();
    await manager.attachProcess('conversation-old', oldProc as unknown as ChildProcess);
    await manager.markIdle('conversation-old');

    vi.setSystemTime(2_000);
    await manager.getOrCreateSession('conversation-new', 'space-1', 'tenant-1', 'user-1');
    const newProc = createClosingProcess();
    await manager.attachProcess('conversation-new', newProc as unknown as ChildProcess);

    const oldSession = await manager.getOrCreateSession('conversation-old', 'space-1', 'tenant-1', 'user-1');
    const newSession = await manager.getOrCreateSession('conversation-new', 'space-1', 'tenant-1', 'user-1');
    expect(oldProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(newProc.kill).not.toHaveBeenCalled();
    expect(oldSession.status).toBe('stopped');
    expect(newSession.status).toBe('running');
  });

  it('hasSession checks memory immediately and can include persisted DB metadata', async () => {
    const persisted = createAgentSessionRow({ conversation_id: 'conversation-db-only' });
    const repository = createRepository([persisted]);
    const manager = await createManager(repository.instance);
    await manager.getOrCreateSession('conversation-memory', 'space-1', 'tenant-1', 'user-1');

    expect(manager.hasSession('conversation-memory')).toBe(true);
    await expect(manager.hasSession('conversation-db-only', { includePersisted: true })).resolves.toBe(true);
    expect(manager.hasSession('conversation-db-only')).toBe(true);
  });

  it('computeOptionsFingerprint is deterministic for equivalent option sets', async () => {
    const manager = await createManager(createRepository().instance);
    const first: AgentSpawnOptions = {
      allowedSpaces: [
        { id: 'space-b', graphPath: '/graphs/b' },
        { id: 'space-a', graphPath: '/graphs/a' },
      ],
      enableDatabase: true,
      databaseConfig: { enabled: true, dsn: 'postgres://readonly@db/cherry' },
      graphBasePath: '/graphs',
      model: 'sonnet',
      maxBudgetUsd: 3,
    };
    const second: AgentSpawnOptions = {
      ...first,
      allowedSpaces: [
        { id: 'space-a', graphPath: '/graphs/a' },
        { id: 'space-b', graphPath: '/graphs/b' },
      ],
    };

    expect(manager.computeOptionsFingerprint(first)).toBe(manager.computeOptionsFingerprint(second));
  });

  it('retentionSweep deletes stale stopped or failed session directories and metadata', async () => {
    const workDir = await createWorkDir('retention');
    const failedDir = `${workDir}.failed.20260501`;
    await mkdir(failedDir, { recursive: true });
    const stale = createAgentSessionRow({
      conversation_id: 'conversation-retention',
      status: 'failed',
      last_activity_at: new Date('2026-04-01T00:00:00.000Z'),
      work_dir: workDir,
      agent_home: join(workDir, '.home'),
    });
    const repository = createRepository([stale]);
    const manager = await createManager(repository.instance, { retentionDays: 7 });

    const deleted = await manager.retentionSweep(new Date('2026-05-08T00:00:00.000Z').getTime());

    expect(deleted).toEqual(['conversation-retention']);
    expect(repository.findStaleForRetentionCleanup).toHaveBeenCalledWith(expect.any(Date), ['stopped', 'failed']);
    expect(repository.delete).toHaveBeenCalledWith('conversation-retention');
    await expect(stat(workDir)).rejects.toThrow();
    await expect(stat(failedDir)).rejects.toThrow();
  });

  it('shutdown terminates live processes without deleting workDir', async () => {
    const repository = createRepository();
    const manager = await createManager(repository.instance);
    const session = await manager.getOrCreateSession('conversation-shutdown', 'space-1', 'tenant-1', 'user-1');
    const proc = createClosingProcess();
    await manager.attachProcess('conversation-shutdown', proc as unknown as ChildProcess);

    await manager.shutdown();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(repository.delete).not.toHaveBeenCalled();
    await expect(stat(session.workDir)).resolves.toBeTruthy();
  });
});

async function createManager(
  repository: AgentSessionRepository,
  config: SessionManagerConfig = {},
): Promise<SessionManager> {
  const agentRoot = await createTempDir('session-manager-root');
  const manager = new SessionManager(repository, {
    agentRoot,
    instanceId: 'instance-local',
    sigintGraceMs: 1,
    ...config,
  });
  managers.push(manager);
  return manager;
}

async function createWorkDir(prefix: string): Promise<string> {
  const dir = await createTempDir(`cherry-agent-${prefix}`);
  await mkdir(join(dir, '.home'), { recursive: true });
  return dir;
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

function createClosingProcess(): ReturnType<typeof createMockProcess> {
  const proc = createMockProcess();
  proc.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    proc.close(0, typeof signal === 'string' ? signal : null);
    return true;
  });
  return proc;
}

function createRepository(initialRows: AgentSessionRow[] = []): MockAgentSessionRepository {
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
        row.updated_at = new Date();
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
        row.updated_at = new Date();
      }
      return Promise.resolve();
    }),
    touchActivity: vi.fn((conversationId: string) => {
      const row = rows.get(conversationId);
      if (row !== undefined) {
        row.last_activity_at = new Date();
        row.updated_at = row.last_activity_at;
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

  return {
    ...repository,
    instance: repository as unknown as AgentSessionRepository,
    rows,
  };
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
    owned_by_instance: 'instance-local',
    last_activity_at: new Date('2026-05-01T00:00:00.000Z'),
    process_started_at: null,
    process_stopped_at: null,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

type MockAgentSessionRepository = {
  instance: AgentSessionRepository;
  rows: Map<string, AgentSessionRow>;
  upsert: Mock<(data: NewAgentSession) => Promise<AgentSessionRow>>;
  findByConversationId: Mock<(conversationId: string) => Promise<AgentSessionRow | undefined>>;
  findByConversationScope: Mock<
    (conversationId: string, tenantId: string, userId: string) => Promise<AgentSessionRow | undefined>
  >;
  updateProviderSessionId: Mock<(conversationId: string, providerSessionId: string) => Promise<void>>;
  updateStatus: Mock<(conversationId: string, status: string, extra?: Partial<AgentSessionRow>) => Promise<void>>;
  updateOwnedByInstance: Mock<(conversationId: string, instanceId: string) => Promise<void>>;
  touchActivity: Mock<(conversationId: string) => Promise<void>>;
  delete: Mock<(conversationId: string) => Promise<void>>;
  findStaleForRetentionCleanup: Mock<(olderThan: Date, statuses: string[]) => Promise<AgentSessionRow[]>>;
};
