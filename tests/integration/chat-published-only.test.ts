import { describe, expect, it } from 'vitest';

import {
  TEST_GROUP_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  collectEvents,
  createSearchRow,
  createServiceContext,
  createSnapshotRow,
  executeSqlParams,
  executeSqlText,
  queueActivatedRetrieval,
  queueAssistantMessage,
  queueStreamPrelude,
  ScriptedChatProvider,
} from './chat-integration-test-utils.js';

describe('chat published wiki retrieval integration', () => {
  it('retrieves chunks only through the activated index snapshot and published wiki filter', async () => {
    const chatProvider = new ScriptedChatProvider([
      { type: 'content', delta: 'The published wiki has the answer [^1].' },
      { type: 'done', finish_reason: 'stop', usage: { prompt_tokens: 18, completion_tokens: 8, total_tokens: 26 } },
    ]);
    const { service, db } = createServiceContext({ chatProvider });

    queueStreamPrelude(db);
    queueActivatedRetrieval(db, {
      snapshot: createSnapshotRow({ id: 'snapshot-activated' }),
      vectorRows: [
        createSearchRow({
          id: 'chunk-published',
          content: 'Published wiki content.',
          page_title: 'Published Page',
        }),
      ],
    });
    queueAssistantMessage(db);

    const events = await collectEvents(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [TEST_GROUP_ID],
        message: 'What is published?',
      }),
    );

    const sqlText = executeSqlText(db);
    expect(sqlText).toContain('wc.index_snapshot_id =');
    expect(sqlText).toContain("wp.status = 'published'");
    expect(executeSqlParams(db)).toContain('snapshot-activated');
    expect(events.find((event) => event.type === 'citations')).toMatchObject({
      citations: [expect.objectContaining({ chunk_id: 'chunk-published' })],
    });
  });

  it('does not query source_documents or file_blobs directly for chat retrieval', async () => {
    const { service, db, chatFactory } = createServiceContext();

    queueStreamPrelude(db);
    queueActivatedRetrieval(db, { vectorRows: [], bm25Rows: [] });
    queueAssistantMessage(db);

    const events = await collectEvents(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [TEST_GROUP_ID],
        message: 'What is in the raw uploaded source document?',
      }),
    );

    const sqlText = executeSqlText(db);
    expect(sqlText).toContain('FROM wiki_chunks wc');
    expect(sqlText).not.toContain('source_documents');
    expect(sqlText).not.toContain('file_blobs');
    expect(chatFactory).not.toHaveBeenCalled();
    expect(events.find((event) => event.type === 'citations')).toEqual({ type: 'citations', citations: [] });
  });
});
