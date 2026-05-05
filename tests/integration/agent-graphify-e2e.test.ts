import '../../apps/api/node_modules/reflect-metadata/Reflect.js';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
import { collectAsync, createRealAgentService } from './agent-integration-test-utils.js';
import { ScriptedChatDb } from './chat-integration-test-utils.js';

const spawnMock = vi.mocked(spawn);
const managers: SessionManager[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(managers.splice(0).map((manager) => manager.onModuleDestroy()));
});

describe('Agent graphify CLI integration', () => {
  it('round-trips graphify query, path, and explain tool_use events', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const service = createRealAgentService({
      db: new ScriptedChatDb(),
      audit: { push: vi.fn() } as unknown as AuditService,
      managers,
    });

    const eventsPromise = collectAsync(
      service.spawnNew(uniqueConversationId('agent-graphify'), 'space-1', 'explain auth graph', {
        allowedSpaces: [
          {
            id: 'space-1',
            name: 'Knowledge',
            graphPath: '/graphs/space-1/graph.json',
          },
        ],
        graphBasePath: '/graphs',
      }),
    );
    await waitForSpawn(1);
    writeJsonLine(proc, {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'query',
            name: 'Bash',
            input: { command: 'graphify query --graph /graphs/space-1/graph.json "SSO"' },
          },
          {
            type: 'tool_use',
            id: 'path',
            name: 'Bash',
            input: { command: 'graphify path --graph /graphs/space-1/graph.json jwt session' },
          },
          {
            type: 'tool_use',
            id: 'explain',
            name: 'Bash',
            input: { command: 'graphify explain --graph /graphs/space-1/graph.json edge-1' },
          },
          { type: 'text', text: 'The graph path is supported by extracted evidence.' },
        ],
      },
    });
    writeJsonLine(proc, {
      type: 'result',
      subtype: 'success',
      session_id: 'graphify-session',
      result: 'graphify complete',
      usage: { input_tokens: 18, output_tokens: 9 },
    });
    proc.close(0);

    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toEqual([
      'agent.tool_use',
      'agent.tool_use',
      'agent.tool_use',
      'message.delta',
      'message.completed',
    ]);
    expect(events.filter((event) => event.type === 'agent.tool_use')).toEqual([
      expect.objectContaining({ id: 'query', input: { command: expect.stringContaining('graphify query') } }),
      expect.objectContaining({ id: 'path', input: { command: expect.stringContaining('graphify path') } }),
      expect.objectContaining({ id: 'explain', input: { command: expect.stringContaining('graphify explain') } }),
    ]);
  });

  it('surfaces graphify CLI failures as Agent errors', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const service = createRealAgentService({
      db: new ScriptedChatDb(),
      audit: { push: vi.fn() } as unknown as AuditService,
      managers,
    });

    const eventsPromise = collectAsync(service.spawnNew(uniqueConversationId('agent-graphify-error'), 'space-1', 'bad graph'));
    await waitForSpawn(1);
    writeJsonLine(proc, {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'query',
            name: 'Bash',
            input: { command: 'graphify query --graph /graphs/missing.json "SSO"' },
          },
        ],
      },
    });
    writeJsonLine(proc, {
      type: 'result',
      subtype: 'error_during_execution',
      error: 'graphify graph file not found',
    });
    proc.close(0);

    await expect(eventsPromise).resolves.toEqual([
      expect.objectContaining({ type: 'agent.tool_use', id: 'query' }),
      { type: 'message.error', code: 'error_during_execution', message: 'graphify graph file not found' },
    ]);
  });
});

async function waitForSpawn(count: number): Promise<void> {
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(count));
}

function uniqueConversationId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
