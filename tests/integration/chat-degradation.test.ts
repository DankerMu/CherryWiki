import { describe, expect, it } from 'vitest';

import {
  NO_HIT_MESSAGE,
  TEST_GROUP_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  chatMessages,
  collectEvents,
  createSpaceRow,
  createServiceContext,
  findInsert,
  queueActivatedRetrieval,
  queueAssistantMessage,
  queueStreamPrelude,
  ScriptedChatProvider,
} from './chat-integration-test-utils.js';

describe('chat degradation integration', () => {
  it('uses strict no-hit response without calling the LLM when retrieval is empty', async () => {
    const chatProvider = new ScriptedChatProvider([
      { type: 'content', delta: 'This should not stream.' },
      { type: 'done', finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    ]);
    const { service, db, chatFactory } = createServiceContext({ chatProvider });

    queueStreamPrelude(db, { space: createSpaceRow({ strict_knowledge_only: true }) });
    queueActivatedRetrieval(db, { vectorRows: [], bm25Rows: [] });
    queueAssistantMessage(db, { id: 'assistant-no-hit', content: NO_HIT_MESSAGE });

    const events = await collectEvents(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [TEST_GROUP_ID],
        message: 'missing topic',
      }),
    );

    expect(events).toEqual([
      { type: 'session', session_id: 'session-1' },
      { type: 'content', delta: NO_HIT_MESSAGE },
      { type: 'citations', citations: [] },
      { type: 'usage', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
      { type: 'message.completed' },
    ]);
    expect(chatFactory).not.toHaveBeenCalled();
    expect(findInsert(db, chatMessages)?.value).toMatchObject({ role: 'user' });
    const assistantInsert = db.inserts.filter((i) => i.table === chatMessages).at(-1);
    expect(assistantInsert?.value).toMatchObject({
      role: 'assistant',
      content: NO_HIT_MESSAGE,
      metadata_json: { source: 'no_hit' },
    });
  });

  it("uses model knowledge metadata and calls the LLM when relaxed retrieval is empty", async () => {
    const chatProvider = new ScriptedChatProvider([
      { type: 'content', delta: 'This answer is from general knowledge.' },
      { type: 'done', finish_reason: 'stop', usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } },
    ]);
    const { service, db, chatFactory } = createServiceContext({ chatProvider });

    queueStreamPrelude(db, { space: createSpaceRow({ strict_knowledge_only: false }) });
    queueActivatedRetrieval(db, { vectorRows: [], bm25Rows: [] });
    queueAssistantMessage(db, { id: 'assistant-relaxed' });

    const events = await collectEvents(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [],
        message: 'Explain something outside the wiki.',
      }),
    );

    expect(events.map((event) => event.type)).toEqual(['session', 'content', 'citations', 'usage', 'message.completed']);
    expect(chatFactory).toHaveBeenCalledTimes(1);
    expect(chatProvider.lastParams?.systemPrompt).toContain('No relevant Wiki sources found');
    const assistantInsert = db.inserts.filter((i) => i.table === chatMessages).at(-1);
    expect(assistantInsert?.value).toMatchObject({
      role: 'assistant',
      metadata_json: { source: 'model_knowledge' },
    });
  });
});
