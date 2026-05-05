import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatController } from '../../apps/api/src/chat/chat.controller.js';
import {
  TEST_GROUP_ID,
  TEST_SPACE_ID,
  callControllerAsFetch,
  createRequest,
  createSearchRow,
  createServiceContext,
  createSessionRow,
  parseSseEvents,
  queueActivatedRetrieval,
  queueAssistantMessage,
  queueStreamPrelude,
  ScriptedChatProvider,
} from './chat-integration-test-utils.js';

describe('chat concurrent load integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('handles 10 concurrent users with valid SSE responses and no errors', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { space_id: string; message: string };
      const userIndex = Number(body.message.match(/\d+$/)?.[0] ?? '0');
      const userId = `load-user-${userIndex}`;
      const chatProvider = new ScriptedChatProvider([
        { type: 'content', delta: `Answer for user ${userIndex} [^1].` },
        { type: 'done', finish_reason: 'stop', usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 } },
      ]);
      const { controller, db } = createServiceContext({ chatProvider });

      queueStreamPrelude(db, {
        session: createSessionRow({ id: `session-${userIndex}`, user_id: userId }),
      });
      queueActivatedRetrieval(db, {
        vectorRows: [
          createSearchRow({
            id: `chunk-${userIndex}`,
            content: `Concurrent wiki fact ${userIndex}.`,
            page_title: `Concurrent Page ${userIndex}`,
          }),
        ],
      });
      queueAssistantMessage(db, { id: `assistant-${userIndex}`, session_id: `session-${userIndex}` });

      return callControllerAsFetch(
        controller as ChatController,
        body,
        createRequest({ userId, groupIds: [TEST_GROUP_ID] }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const responses = await withTimeout(
      Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          fetch('http://chat.local/api/chat/completions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              space_id: TEST_SPACE_ID,
              message: `concurrent question ${index}`,
            }),
          }),
        ),
      ),
      1_000,
    );
    const bodies = await Promise.all(responses.map((response) => response.text()));

    expect(fetchMock).toHaveBeenCalledTimes(10);
    for (const [index, response] of responses.entries()) {
      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(bodies[index]).not.toContain('event: error');
      expect(parseSseEvents(bodies[index] ?? '').map((event) => event.event ?? event.data)).toEqual([
        'session',
        'content',
        'citations',
        'usage',
        'message.completed',
        '[DONE]',
      ]);
    }
  });
});

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}
