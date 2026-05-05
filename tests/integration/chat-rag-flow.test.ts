import { describe, expect, it } from 'vitest';

import {
  TEST_GROUP_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  answerCitations,
  collectEvents,
  createSearchRow,
  createServiceContext,
  findInsert,
  queueActivatedRetrieval,
  queueAssistantMessage,
  queueStreamPrelude,
  ScriptedChatProvider,
  ScriptedEmbeddingProvider,
} from './chat-integration-test-utils.js';

describe('chat RAG flow integration', () => {
  it('streams a retrieval-backed answer and persists extracted citations', async () => {
    const chatProvider = new ScriptedChatProvider([
      { type: 'content', delta: 'SSO is configured from the published wiki [^1]. ' },
      { type: 'content', delta: 'MFA is enforced for admins [^2].' },
      { type: 'done', finish_reason: 'stop', usage: { prompt_tokens: 38, completion_tokens: 15, total_tokens: 53 } },
    ]);
    const embeddingProvider = new ScriptedEmbeddingProvider([[0.12, 0.34, 0.56]]);
    const { service, db } = createServiceContext({ chatProvider, embeddingProvider });

    queueStreamPrelude(db);
    queueActivatedRetrieval(db, {
      vectorRows: [
        createSearchRow({
          id: 'chunk-sso',
          content: 'SSO is configured in Admin > Auth.',
          wiki_page_pk: 'wiki-auth',
          page_title: 'Auth',
          section_title: 'SSO',
          score: 0.92,
        }),
        createSearchRow({
          id: 'chunk-mfa',
          content: 'MFA is enforced for administrators.',
          wiki_page_pk: 'wiki-security',
          page_title: 'Security',
          section_title: 'MFA',
          score: 0.88,
        }),
      ],
    });
    queueAssistantMessage(db, { id: 'assistant-answer' });

    const events = await collectEvents(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [TEST_GROUP_ID],
        message: 'How are SSO and MFA configured?',
      }),
    );

    const citationsEvent = events.find((event) => event.type === 'citations');
    expect(events.map((event) => event.type)).toEqual(['session', 'content', 'content', 'citations', 'usage', 'message.completed']);
    expect(citationsEvent).toMatchObject({
      type: 'citations',
      citations: [
        expect.objectContaining({ chunk_id: 'chunk-sso', fallback: false }),
        expect.objectContaining({ chunk_id: 'chunk-mfa', fallback: false }),
      ],
    });

    const citationInsert = findInsert(db, answerCitations);
    expect(citationInsert?.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message_id: 'assistant-answer', chunk_id: 'chunk-sso' }),
        expect.objectContaining({ message_id: 'assistant-answer', chunk_id: 'chunk-mfa' }),
      ]),
    );
    expect(embeddingProvider.calls).toEqual([['How are SSO and MFA configured?']]);
    expect(chatProvider.lastParams?.systemPrompt).toContain('[^1] (Page: Auth, Section: SSO)');
  });
});
