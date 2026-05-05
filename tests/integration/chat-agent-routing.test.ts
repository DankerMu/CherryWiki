import '../../apps/api/node_modules/reflect-metadata/Reflect.js';

import { describe, expect, it } from 'vitest';

import type { AgentService } from '../../apps/api/src/agent/agent.service.js';
import {
  ScriptedAgentService,
} from './agent-integration-test-utils.js';
import {
  TEST_GROUP_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  collectEvents,
  createSearchRow,
  createServiceContext,
  queueActivatedRetrieval,
  queueAssistantMessage,
  queueStreamPrelude,
  ScriptedChatProvider,
} from './chat-integration-test-utils.js';

describe('chat Agent routing integration', () => {
  it('keeps simple fact lookups on the static RAG path', async () => {
    const agent = new ScriptedAgentService([
      { type: 'message.delta', delta: 'agent should not run' },
      { type: 'message.completed' },
    ]);
    const chatProvider = new ScriptedChatProvider([
      { type: 'content', delta: 'SSO is enabled from wiki [^1].' },
      { type: 'done', finish_reason: 'stop', usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 } },
    ]);
    const { service, db } = createServiceContext({
      chatProvider,
      agentService: agent as unknown as AgentService,
    });

    queueStreamPrelude(db);
    queueActivatedRetrieval(db, { vectorRows: [createSearchRow()] });
    queueAssistantMessage(db);

    const events = await collectEvents(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [TEST_GROUP_ID],
        message: 'what is SSO?',
      }),
    );

    expect(agent.spawnCalls).toHaveLength(0);
    expect(events.map((event) => event.type)).toEqual([
      'session',
      'content',
      'citations',
      'usage',
      'message.completed',
    ]);
    expect(chatProvider.lastParams?.systemPrompt).toContain('Context blocks:');
  });

  it('routes explicit deep analysis to Agent and propagates Agent SSE events', async () => {
    const agent = new ScriptedAgentService([
      { type: 'agent.tool_use', id: 'tool-1', name: 'Bash', input: { command: 'graphify query "SSO"' } },
      { type: 'message.delta', delta: 'Graph evidence found.' },
      { type: 'message.completed', usage: { input_tokens: 12, output_tokens: 4 } },
    ]);
    const { service, db, chatFactory } = createServiceContext({
      agentService: agent as unknown as AgentService,
    });

    queueStreamPrelude(db);
    queueAssistantMessage(db);

    const events = await collectEvents(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [TEST_GROUP_ID],
        message: 'explain the relationship between SSO and sessions',
        enableDeepAnalysis: true,
      }),
    );

    expect(agent.spawnCalls).toEqual([
      expect.objectContaining({
        conversationId: 'session-1',
        spaceId: TEST_SPACE_ID,
        message: 'explain the relationship between SSO and sessions',
      }),
    ]);
    expect(events).toEqual([
      { type: 'session', session_id: 'session-1' },
      { type: 'agent.tool_use', id: 'tool-1', name: 'Bash', input: { command: 'graphify query "SSO"' } },
      { type: 'content', delta: 'Graph evidence found.' },
      { type: 'usage', usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } },
      { type: 'message.completed' },
    ]);
    expect(chatFactory).not.toHaveBeenCalled();
  });

  it('routes graph_rag mode to Agent and surfaces Agent errors', async () => {
    const agent = new ScriptedAgentService([
      { type: 'message.error', code: 'tool_error', message: 'graphify query failed' },
    ]);
    const { service, db } = createServiceContext({
      agentService: agent as unknown as AgentService,
    });

    queueStreamPrelude(db);

    const events = await collectEvents(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [TEST_GROUP_ID],
        message: 'show graph paths for auth',
        retrievalMode: 'graph_rag',
      }),
    );

    expect(agent.spawnCalls).toHaveLength(1);
    expect(events).toEqual([
      { type: 'session', session_id: 'session-1' },
      { type: 'error', code: 'tool_error', message: 'graphify query failed' },
    ]);
  });
});
