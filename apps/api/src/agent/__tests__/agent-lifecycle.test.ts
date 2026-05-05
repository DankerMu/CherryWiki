import 'reflect-metadata';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import type { AuditService } from '../../audit/audit.service.js';
import type { DrizzleDatabase } from '../../database/drizzle.module.js';
import { AgentService } from '../agent.service.js';
import { AuditCapture } from '../audit-capture.js';
import { ClaudeMdGenerator } from '../claude-md-generator.js';
import { SessionManager } from '../session-manager.js';
import { SettingsGenerator } from '../settings-generator.js';
import { StreamParser } from '../stream-parser.js';
import { AgentTestDb, collectAsync, createMockProcess, writeJsonLine, type MockAgentProcess } from './agent-test-utils.js';

const spawnMock = vi.mocked(spawn);
const managers: SessionManager[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  await Promise.all(managers.splice(0).map((manager) => manager.onModuleDestroy()));
});

describe('AgentService lifecycle', () => {
  it('spawnNew creates the workdir, CLAUDE.md, settings.json, and streams completion events', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const { service, db } = createService();
    const conversationId = uniqueConversationId('conversation-life-1');

    const eventsPromise = collectAsync(
      service.spawnNew(conversationId, 'space-1', 'explain SSO', {
        tenantId: 'tenant-1',
        userId: 'user-1',
        allowedSpaces: [{ id: 'space-1', name: 'Knowledge' }],
        apiInternalUrl: 'http://cherry-api.internal',
        agentToken: 'agent-token',
        model: 'claude-sonnet-test',
        agentModelConfigId: 'agent-model-config',
      }),
    );
    await waitForSpawn();
    writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: 'claude-session-1' });
    writeJsonLine(proc, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'SSO uses redirects.' }] },
    });
    writeJsonLine(proc, {
      type: 'result',
      subtype: 'success',
      session_id: 'claude-session-1',
      usage: { input_tokens: 10, output_tokens: 4 },
    });
    proc.close(0);

    const events = await eventsPromise;
    const session = service.getSession(conversationId);
    const timing = service.getTiming(conversationId);

    expect(events.map((event) => event.type)).toEqual(['message.delta', 'message.completed']);
    expect(events[1]).toMatchObject({
      type: 'message.completed',
      latency_ms: expect.any(Number),
      first_sse_latency_ms: expect.any(Number),
    });
    expect(timing?.spawn_at).toBeInstanceOf(Date);
    expect(timing?.first_sse_at).toBeInstanceOf(Date);
    expect(timing?.completed_at).toBeInstanceOf(Date);
    expect(db.inserts[0]?.value).toMatchObject({
      tenant_id: 'tenant-1',
      model_config_id: 'agent-model-config',
      request_type: 'agent_deep',
      input_tokens: 10,
      output_tokens: 4,
      space_id: 'space-1',
      conversation_id: conversationId,
    });
    expect(session?.sessionId).toBe('claude-session-1');
    expect(await readFile(join(session?.workDir ?? '', 'CLAUDE.md'), 'utf8')).toContain('Knowledge');
    const settings = JSON.parse(await readFile(join(session?.workDir ?? '', 'settings.json'), 'utf8')) as Record<string, unknown>;
    expect(settings).toMatchObject({ tools: ['Bash', 'Read'] });
    expect(settings).not.toHaveProperty('env');
    expect(settings).not.toHaveProperty('model');
    expect((await stat(session?.workDir ?? '')).mode & 0o777).toBe(0o700);

    const call = spawnMock.mock.calls[0];
    expect(call?.[0]).toBe('claude');
    expect(call?.[1]).toEqual(
      expect.arrayContaining([
        '--print',
        '--session-id',
        expect.any(String),
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--tools',
        'Bash,Read',
        '--permission-mode',
        'bypassPermissions',
        '--max-budget-usd',
        '2',
        '-p',
        'explain SSO',
      ]),
    );
    expect(call?.[2]).toMatchObject({
      cwd: session?.workDir,
      env: expect.objectContaining({
        HOME: session?.agentHome,
        CHERRY_API_INTERNAL_URL: 'http://cherry-api.internal',
        CHERRY_AGENT_TOKEN: 'agent-token',
      }),
    });
  });

  it('resume reuses the captured Claude session id', async () => {
    const first = createMockProcess();
    const second = createMockProcess();
    spawnMock.mockReturnValueOnce(first as never).mockReturnValueOnce(second as never);
    const { service } = createService();
    const conversationId = uniqueConversationId('conversation-life-2');

    const initialPromise = collectAsync(service.spawnNew(conversationId, 'space-1', 'first'));
    await waitForSpawn(1);
    writeJsonLine(first, { type: 'system', subtype: 'init', session_id: 'claude-session-resume' });
    writeJsonLine(first, { type: 'result', subtype: 'success', session_id: 'claude-session-resume' });
    first.close(0);
    await initialPromise;

    const resumePromise = collectAsync(service.resume(conversationId, 'follow up'));
    await waitForSpawn(2);
    writeJsonLine(second, { type: 'assistant', message: { content: [{ type: 'text', text: 'continued' }] } });
    writeJsonLine(second, { type: 'result', subtype: 'success', session_id: 'claude-session-resume' });
    second.close(0);
    await resumePromise;

    expect(spawnMock.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(['--resume', 'claude-session-resume', '-p', 'follow up']),
    );
  });

  it('resume falls back to a fresh spawn when Claude resume exits non-zero', async () => {
    const first = createMockProcess();
    const failedResume = createMockProcess();
    const fresh = createMockProcess();
    spawnMock
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(failedResume as never)
      .mockReturnValueOnce(fresh as never);
    const { service } = createService();
    const conversationId = uniqueConversationId('conversation-life-3');

    const initialPromise = collectAsync(service.spawnNew(conversationId, 'space-1', 'first'));
    await waitForSpawn(1);
    writeJsonLine(first, { type: 'system', subtype: 'init', session_id: 'broken-session' });
    writeJsonLine(first, { type: 'result', subtype: 'success', session_id: 'broken-session' });
    first.close(0);
    await initialPromise;

    const session = service.getSession(conversationId);
    await mkdir(join(session?.agentHome ?? '', '.claude'), { recursive: true });

    const resumePromise = collectAsync(service.resume(conversationId, 'recover'));
    await waitForSpawn(2);
    failedResume.close(1);
    await waitForSpawn(3);
    writeJsonLine(fresh, { type: 'system', subtype: 'init', session_id: 'fresh-session' });
    writeJsonLine(fresh, { type: 'result', subtype: 'success', session_id: 'fresh-session' });
    fresh.close(0);
    await resumePromise;

    expect(spawnMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(['--resume', 'broken-session']));
    expect(spawnMock.mock.calls[2]?.[1]).toEqual(expect.arrayContaining(['--session-id', expect.any(String)]));
    await expect(stat(join(session?.agentHome ?? '', '.claude'))).rejects.toThrow();
  });

  it('resume falls back to a fresh spawn when Claude reports a resume session error before content', async () => {
    const first = createMockProcess();
    const failedResume = createMockProcess();
    const fresh = createMockProcess();
    spawnMock
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(failedResume as never)
      .mockReturnValueOnce(fresh as never);
    const { service } = createService();
    const conversationId = uniqueConversationId('conversation-life-resume-error');

    const initialPromise = collectAsync(service.spawnNew(conversationId, 'space-1', 'first'));
    await waitForSpawn(1);
    writeJsonLine(first, { type: 'system', subtype: 'init', session_id: 'broken-session' });
    writeJsonLine(first, { type: 'result', subtype: 'success', session_id: 'broken-session' });
    first.close(0);
    await initialPromise;

    const session = service.getSession(conversationId);
    await mkdir(join(session?.agentHome ?? '', '.claude'), { recursive: true });

    const resumePromise = collectAsync(service.resume(conversationId, 'recover'));
    await waitForSpawn(2);
    writeJsonLine(failedResume, {
      type: 'result',
      subtype: 'error_during_execution',
      error: 'Could not resume session broken-session',
    });
    failedResume.close(0);
    await waitForSpawn(3);
    writeJsonLine(fresh, { type: 'system', subtype: 'init', session_id: 'fresh-session' });
    writeJsonLine(fresh, { type: 'result', subtype: 'success', session_id: 'fresh-session' });
    fresh.close(0);

    const events = await resumePromise;

    expect(events.map((event) => event.type)).toEqual(['message.completed']);
    expect(spawnMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(['--resume', 'broken-session']));
    expect(spawnMock.mock.calls[2]?.[1]).toEqual(expect.arrayContaining(['--session-id', expect.any(String)]));
    await expect(stat(join(session?.agentHome ?? '', '.claude'))).rejects.toThrow();
  });

  it('cleanup deletes the work directory', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const { service } = createService();
    const conversationId = uniqueConversationId('conversation-life-4');

    const eventsPromise = collectAsync(service.spawnNew(conversationId, 'space-1', 'hello'));
    await waitForSpawn();
    writeJsonLine(proc, { type: 'result', subtype: 'success', session_id: 'session-cleanup' });
    proc.close(0);
    await eventsPromise;

    const workDir = service.getSession(conversationId)?.workDir;
    await service.close(conversationId);

    await expect(stat(workDir ?? '')).rejects.toThrow();
  });

  it('kills a process after the one-hour timeout with SIGTERM then SIGKILL', async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const { service } = createService();
    const conversationId = uniqueConversationId('conversation-life-5');

    const iterator = service.spawnNew(conversationId, 'space-1', 'long task');
    const nextPromise = iterator.next();
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');

    proc.close(0);
    await nextPromise;
  });

  it('terminates the child process when the stream consumer disconnects', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const { service } = createService();
    const conversationId = uniqueConversationId('conversation-life-disconnect');

    const iterator = service.spawnNew(conversationId, 'space-1', 'long task');
    const firstEventPromise = iterator.next();
    await waitForSpawn();
    writeJsonLine(proc, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'partial' }] },
    });
    await expect(firstEventPromise).resolves.toMatchObject({
      done: false,
      value: { type: 'message.delta', delta: 'partial' },
    });

    const returnPromise = iterator.return(undefined);
    await vi.waitFor(() => expect(proc.kill).toHaveBeenCalledWith('SIGTERM'));
    proc.close(null, 'SIGTERM');
    await returnPromise;

    expect(service.getActiveAgentCount()).toBe(0);
    expect(service.getSession(conversationId)?.processRef).toBeUndefined();
  });

  it('queues agents FIFO when the concurrency limit is reached', async () => {
    const first = createMockProcess();
    const second = createMockProcess();
    spawnMock.mockReturnValueOnce(first as never).mockReturnValueOnce(second as never);
    const { service } = createService();
    const firstConversationId = uniqueConversationId('conversation-queue-1');
    const secondConversationId = uniqueConversationId('conversation-queue-2');

    const firstPromise = collectAsync(
      service.spawnNew(firstConversationId, 'space-1', 'first', { maxConcurrentAgents: 1 }),
    );
    await waitForSpawn(1);

    const secondPromise = collectAsync(
      service.spawnNew(secondConversationId, 'space-1', 'second', { maxConcurrentAgents: 1 }),
    );
    await vi.waitFor(() => expect(service.getQueuedAgentCount()).toBe(1));

    expect(service.getActiveAgentCount()).toBe(1);
    expect(service.getQueuedAgentCount()).toBe(1);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    writeJsonLine(first, { type: 'result', subtype: 'success', session_id: 'queue-first' });
    first.close(0);
    await firstPromise;
    await waitForSpawn(2);

    writeJsonLine(second, { type: 'result', subtype: 'success', session_id: 'queue-second' });
    second.close(0);
    await secondPromise;

    expect(spawnMock.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['-p', 'first']));
    expect(spawnMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(['-p', 'second']));
  });
});

function createService(): { service: AgentService; manager: SessionManager; db: AgentTestDb } {
  const db = new AgentTestDb();
  const manager = new SessionManager();
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

  return { service, manager, db };
}

async function waitForSpawn(count = 1): Promise<void> {
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(count));
}

function uniqueConversationId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
