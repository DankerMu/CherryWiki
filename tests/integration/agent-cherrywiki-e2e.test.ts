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

describe('Agent cherrywiki CLI integration', () => {
  it('round-trips cherrywiki search and page tool_use events', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const service = createRealAgentService({
      db: new ScriptedChatDb(),
      audit: { push: vi.fn() } as unknown as AuditService,
      managers,
    });

    const eventsPromise = collectAsync(
      service.spawnNew(uniqueConversationId('agent-cherrywiki'), 'space-1', 'find SSO docs', {
        allowedSpaces: [{ id: 'space-1', name: 'Knowledge' }],
        apiInternalUrl: 'http://cherry-api:8080',
        agentToken: 'agent-token',
      }),
    );
    await waitForSpawn(1);
    writeJsonLine(proc, {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'search',
            name: 'Bash',
            input: { command: 'cherrywiki search "SSO" --space space-1 --top 3' },
          },
          {
            type: 'tool_use',
            id: 'page',
            name: 'Bash',
            input: { command: 'cherrywiki page wiki-page-public-id --section section-1' },
          },
          { type: 'text', text: 'The page says SSO is configured in Admin > Auth.' },
        ],
      },
    });
    writeJsonLine(proc, {
      type: 'result',
      subtype: 'success',
      session_id: 'cherrywiki-session',
      usage: { input_tokens: 15, output_tokens: 7 },
    });
    proc.close(0);

    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toEqual([
      'agent.tool_use',
      'agent.tool_use',
      'message.delta',
      'message.completed',
    ]);
    expect(events.filter((event) => event.type === 'agent.tool_use')).toEqual([
      expect.objectContaining({ id: 'search', input: { command: expect.stringContaining('cherrywiki search') } }),
      expect.objectContaining({ id: 'page', input: { command: expect.stringContaining('cherrywiki page') } }),
    ]);
  });

  it('surfaces cherrywiki authentication failures as Agent errors', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const service = createRealAgentService({
      db: new ScriptedChatDb(),
      audit: { push: vi.fn() } as unknown as AuditService,
      managers,
    });

    const eventsPromise = collectAsync(service.spawnNew(uniqueConversationId('agent-cherrywiki-error'), 'space-1', 'search'));
    await waitForSpawn(1);
    writeJsonLine(proc, {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'search', name: 'Bash', input: { command: 'cherrywiki search "SSO"' } },
        ],
      },
    });
    writeJsonLine(proc, {
      type: 'result',
      subtype: 'error_during_execution',
      error: 'cherrywiki authentication failed',
    });
    proc.close(0);

    await expect(eventsPromise).resolves.toEqual([
      expect.objectContaining({ type: 'agent.tool_use', id: 'search' }),
      { type: 'message.error', code: 'error_during_execution', message: 'cherrywiki authentication failed' },
    ]);
  });
});

async function waitForSpawn(count: number): Promise<void> {
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(count));
}

function uniqueConversationId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
