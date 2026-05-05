import '../../apps/api/node_modules/reflect-metadata/Reflect.js';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import type { AuditService } from '../../apps/api/src/audit/audit.service.js';
import type { SessionManager } from '../../apps/api/src/agent/session-manager.js';
import {
  createMockProcess,
  writeJsonLine,
} from '../../apps/api/src/agent/__tests__/agent-test-utils.js';
import {
  collectAsync,
  createRealAgentService,
} from './agent-integration-test-utils.js';
import { ScriptedChatDb } from './chat-integration-test-utils.js';

const spawnMock = vi.mocked(spawn);
const managers: SessionManager[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  await Promise.all(managers.splice(0).map((manager) => manager.onModuleDestroy()));
});

describe('Agent lifecycle integration', () => {
  it('spawns, streams graphify tool_use SSE, resumes, and cleans up the work directory', async () => {
    const first = createMockProcess();
    const second = createMockProcess();
    spawnMock.mockReturnValueOnce(first as never).mockReturnValueOnce(second as never);
    const db = new ScriptedChatDb();
    const audit = { push: vi.fn() } as unknown as AuditService;
    const service = createRealAgentService({ db, audit, managers });
    const conversationId = uniqueConversationId('agent-e2e');

    const spawnEventsPromise = collectAsync(
      service.spawnNew(conversationId, 'space-1', 'find the SSO graph path', {
        tenantId: 'tenant-1',
        userId: 'user-1',
        allowedSpaces: [{ id: 'space-1', name: 'Knowledge' }],
      }),
    );
    await waitForSpawn(1);
    writeJsonLine(first, { type: 'system', subtype: 'init', session_id: 'claude-session-1' });
    writeJsonLine(first, {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tool-graphify', name: 'Bash', input: { command: 'graphify query "SSO"' } },
          { type: 'text', text: 'SSO is connected to session management.' },
        ],
      },
    });
    writeJsonLine(first, {
      type: 'result',
      subtype: 'success',
      session_id: 'claude-session-1',
      usage: { input_tokens: 20, output_tokens: 8 },
    });
    first.close(0);

    const spawnEvents = await spawnEventsPromise;
    expect(spawnEvents).toEqual([
      { type: 'agent.tool_use', id: 'tool-graphify', name: 'Bash', input: { command: 'graphify query "SSO"' } },
      { type: 'message.delta', delta: 'SSO is connected to session management.' },
      expect.objectContaining({
        type: 'message.completed',
        session_id: 'claude-session-1',
        usage: { input_tokens: 20, output_tokens: 8 },
      }),
    ]);

    const resumeEventsPromise = collectAsync(service.resume(conversationId, 'continue'));
    await waitForSpawn(2);
    writeJsonLine(second, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Continuing from the same Claude session.' }] },
    });
    writeJsonLine(second, { type: 'result', subtype: 'success', session_id: 'claude-session-1' });
    second.close(0);

    await expect(resumeEventsPromise).resolves.toEqual([
      { type: 'message.delta', delta: 'Continuing from the same Claude session.' },
      expect.objectContaining({ type: 'message.completed', session_id: 'claude-session-1' }),
    ]);
    expect(spawnMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(['--resume', 'claude-session-1']));

    const workDir = service.getSession(conversationId)?.workDir;
    await service.close(conversationId);
    await expect(stat(workDir ?? '')).rejects.toThrow();
  });

  it('times out a hung Claude process with SIGTERM followed by SIGKILL', async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const db = new ScriptedChatDb();
    const audit = { push: vi.fn() } as unknown as AuditService;
    const service = createRealAgentService({ db, audit, managers });

    const iterator = service.spawnNew(uniqueConversationId('agent-timeout'), 'space-1', 'long graph task', {
      timeoutMs: 100,
    });
    const nextPromise = iterator.next();
    await waitForSpawn(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');

    proc.close(0);
    await nextPromise;
  });

  it('maps Claude process failures to Agent error events', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const db = new ScriptedChatDb();
    const audit = { push: vi.fn() } as unknown as AuditService;
    const service = createRealAgentService({ db, audit, managers });

    const eventsPromise = collectAsync(service.spawnNew(uniqueConversationId('agent-error'), 'space-1', 'fail'));
    await waitForSpawn(1);
    proc.close(1);

    await expect(eventsPromise).resolves.toEqual([
      { type: 'message.error', code: 'process_error', message: 'Claude process exited with code 1' },
    ]);
  });
});

async function waitForSpawn(count: number): Promise<void> {
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(count));
}

function uniqueConversationId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
