import '../../apps/api/node_modules/reflect-metadata/Reflect.js';

import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import { ChatService } from '../../apps/api/src/chat/chat.service.js';
import type { AuditService } from '../../apps/api/src/audit/audit.service.js';
import {
  TEST_GROUP_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  collectEvents,
  createMessageRow,
  createSpaceRow,
  createSearchRow,
  createSessionRow,
  queueActivatedRetrieval,
  queueAssistantMessage,
  queueStreamPrelude,
  ScriptedChatDb,
  ScriptedChatProvider,
  ScriptedEmbeddingProvider,
} from './chat-integration-test-utils.js';
import { percentile95, sleep } from './agent-integration-test-utils.js';

describe('static RAG performance integration', () => {
  it('keeps static RAG P95 under 3 seconds with controlled retrieval latency', async () => {
    const db = new DelayedChatDb(8);
    const chatProvider = new ScriptedChatProvider([
      { type: 'content', delta: 'SSO is configured from the wiki [^1].' },
      { type: 'done', finish_reason: 'stop', usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } },
    ]);
    const service = createStaticRagService(db, chatProvider);
    const durations: number[] = [];

    for (let index = 0; index < 20; index += 1) {
      queueStreamPrelude(db, {
        session: createSessionRow({ id: `perf-session-${index}` }),
        userMessage: createMessageRow({
          id: `perf-user-${index}`,
          session_id: `perf-session-${index}`,
          role: 'user',
          content: 'what is SSO?',
        }),
      });
      queueActivatedRetrieval(db, {
        vectorRows: [createSearchRow({ id: `perf-chunk-${index}`, score: 0.9 })],
        bm25Rows: [],
      });
      queueAssistantMessage(db, { id: `perf-assistant-${index}` });

      const startedAt = performance.now();
      const events = await collectEvents(
        await service.streamCompletion({
          tenantId: TEST_TENANT_ID,
          spaceId: TEST_SPACE_ID,
          userId: TEST_USER_ID,
          userGroupIds: [TEST_GROUP_ID],
          message: 'what is SSO?',
        }),
      );
      durations.push(performance.now() - startedAt);
      expect(events.at(-1)).toEqual({ type: 'message.completed' });
    }

    expect(percentile95(durations)).toBeLessThan(3_000);
    expect(db.executeQueries.length).toBeGreaterThanOrEqual(20);
  });

  it('returns a bounded error event when controlled retrieval yields no context and the provider fails', async () => {
    const db = new DelayedChatDb(5);
    const service = createStaticRagService(db, new ScriptedChatProvider([{ type: 'error', error: 'provider failed' }]));

    queueStreamPrelude(db, { space: createSpaceRow({ strict_knowledge_only: false }) });
    queueActivatedRetrieval(db, { vectorRows: [], bm25Rows: [] });

    const startedAt = performance.now();
    const events = await collectEvents(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [TEST_GROUP_ID],
        message: 'what is SSO?',
      }),
    );

    expect(performance.now() - startedAt).toBeLessThan(3_000);
    expect(events).toEqual([
      { type: 'session', session_id: 'session-1' },
      { type: 'error', code: 'INTERNAL_ERROR', message: 'Chat completion failed' },
    ]);
  });
});

function createStaticRagService(db: ScriptedChatDb, chatProvider: ScriptedChatProvider): ChatService {
  const embeddingProvider = new ScriptedEmbeddingProvider([[0.2, 0.1, 0.3]]);
  return new ChatService(
    db.asDrizzle(),
    { push: () => undefined } as unknown as AuditService,
    () => chatProvider,
    () => embeddingProvider,
  );
}

class DelayedChatDb extends ScriptedChatDb {
  constructor(private readonly latencyMs: number) {
    super();
  }

  override async execute(query: unknown): Promise<{ rows: unknown[] }> {
    await sleep(this.latencyMs);
    return super.execute(query);
  }
}
