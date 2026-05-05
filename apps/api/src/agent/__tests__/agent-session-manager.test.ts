import 'reflect-metadata';

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { SessionManager } from '../session-manager.js';
import type { AgentSessionRecord } from '../dto/agent.dto.js';
import { createMockProcess } from './agent-test-utils.js';

const managers: SessionManager[] = [];
void spawn;

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(managers.splice(0).map((manager) => manager.onModuleDestroy()));
});

describe('SessionManager', () => {
  it('interval cleanup removes sessions idle for 10 minutes', async () => {
    vi.useFakeTimers();
    const manager = createManager();
    manager.configureForTests({ idleTimeoutMs: 10 * 60_000, cleanupIntervalMs: 1_000 });
    const workDir = await createWorkDir('idle');
    manager.setSession(createSessionRecord('conversation-idle', workDir, Date.now() - 10 * 60_000));

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(manager.hasSession('conversation-idle')).toBe(false));

    await vi.waitFor(async () => {
      await expect(stat(workDir)).rejects.toThrow();
    });
  });

  it('close deletes the work directory and terminates a tracked process', async () => {
    const manager = createManager();
    const workDir = await createWorkDir('close');
    const processRef = createMockProcess();
    manager.setSession(createSessionRecord('conversation-close', workDir, Date.now(), processRef));

    await manager.close('conversation-close');

    expect(processRef.kill).toHaveBeenCalledWith('SIGTERM');
    expect(manager.hasSession('conversation-close')).toBe(false);
    await expect(stat(workDir)).rejects.toThrow();
  });

  it('tracks concurrent sessions without deleting active conversations', async () => {
    const manager = createManager();
    manager.configureForTests({ idleTimeoutMs: 100 });
    const activeDir = await createWorkDir('active');
    const idleDir = await createWorkDir('idle-old');
    manager.setSession(createSessionRecord('conversation-active', activeDir, 1_000));
    manager.setSession(createSessionRecord('conversation-idle-old', idleDir, 1_000));

    await Promise.all([
      Promise.resolve().then(() => manager.touch('conversation-active', 1_200)),
      Promise.resolve().then(() => manager.setSessionId('conversation-active', 'session-updated')),
      Promise.resolve().then(() => manager.sweepIdleSessions(1_150)),
    ]);

    expect(manager.hasSession('conversation-active')).toBe(true);
    expect(manager.getSession('conversation-active')?.sessionId).toBe('session-updated');
    expect(manager.hasSession('conversation-idle-old')).toBe(false);
    await expect(stat(activeDir)).resolves.toBeTruthy();
    await expect(stat(idleDir)).rejects.toThrow();
  });
});

function createManager(): SessionManager {
  const manager = new SessionManager();
  managers.push(manager);
  return manager;
}

async function createWorkDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `cherry-agent-${prefix}-`));
  await mkdir(join(dir, '.home'), { recursive: true });
  return dir;
}

function createSessionRecord(
  conversationId: string,
  workDir: string,
  lastActivityAt: number,
  processRef?: ReturnType<typeof createMockProcess>,
): AgentSessionRecord {
  return {
    conversationId,
    spaceId: 'space-1',
    sessionId: 'session-1',
    workDir,
    agentHome: join(workDir, '.home'),
    lastActivityAt,
    ...(processRef !== undefined ? { processRef: processRef as unknown as ChildProcess } : {}),
    options: {},
  };
}
