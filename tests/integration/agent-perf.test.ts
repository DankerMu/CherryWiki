import '../../apps/api/node_modules/reflect-metadata/Reflect.js';

import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import type { AgentService } from '../../apps/api/src/agent/agent.service.js';
import type { ChatStreamEvent } from '../../apps/api/src/chat/chat.service.js';
import {
  ScriptedAgentService,
  TimedAgentService,
  percentile95,
} from './agent-integration-test-utils.js';
import {
  TEST_GROUP_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  collectEvents,
  createMessageRow,
  createServiceContext,
  createSessionRow,
  queueAssistantMessage,
  queueStreamPrelude,
} from './chat-integration-test-utils.js';

describe('Agent deep path performance integration', () => {
  it('keeps first SSE P95 under 10 seconds and total P95 under 30 seconds', async () => {
    const agent = new TimedAgentService(15, 35);
    const { service, db } = createServiceContext({
      agentService: agent as unknown as AgentService,
    });
    const firstSseLatencies: number[] = [];
    const totalLatencies: number[] = [];

    for (let index = 0; index < 20; index += 1) {
      queueStreamPrelude(db, {
        session: createSessionRow({ id: `agent-perf-session-${index}` }),
        userMessage: createMessageRow({
          id: `agent-perf-user-${index}`,
          session_id: `agent-perf-session-${index}`,
          role: 'user',
          content: 'deep analysis',
        }),
      });
      queueAssistantMessage(db, { id: `agent-perf-assistant-${index}` });

      const startedAt = performance.now();
      let firstSseAt: number | undefined;
      const events: ChatStreamEvent[] = [];
      for await (const event of await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [TEST_GROUP_ID],
        message: 'explain the relationship between auth and sessions',
        enableDeepAnalysis: true,
      })) {
        events.push(event);
        if (event.type !== 'session' && firstSseAt === undefined) {
          firstSseAt = performance.now();
        }
      }

      expect(events.at(-1)).toEqual({ type: 'message.completed' });
      firstSseLatencies.push((firstSseAt ?? performance.now()) - startedAt);
      totalLatencies.push(performance.now() - startedAt);
    }

    expect(percentile95(firstSseLatencies)).toBeLessThan(10_000);
    expect(percentile95(totalLatencies)).toBeLessThan(30_000);
  });

  it('surfaces fast Agent errors within the first-SSE threshold', async () => {
    const agent = new ScriptedAgentService([
      { type: 'message.error', code: 'agent_unavailable', message: 'mock Agent failed before first token' },
    ]);
    const { service, db } = createServiceContext({
      agentService: agent as unknown as AgentService,
    });

    queueStreamPrelude(db);

    const startedAt = performance.now();
    const events = await collectEvents(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [TEST_GROUP_ID],
        message: 'why does auth depend on sessions?',
        enableDeepAnalysis: true,
      }),
    );

    expect(performance.now() - startedAt).toBeLessThan(10_000);
    expect(events).toEqual([
      { type: 'session', session_id: 'session-1' },
      { type: 'error', code: 'agent_unavailable', message: 'mock Agent failed before first token' },
    ]);
  });
});
