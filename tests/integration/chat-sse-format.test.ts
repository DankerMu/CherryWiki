import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { ResponseWrapperInterceptor } from '../../apps/api/src/common/interceptors/response-wrapper.interceptor.js';
import { describe, expect, it, vi } from 'vitest';

import { ChatController } from '../../apps/api/src/chat/chat.controller.js';
import type { ChatService, ChatStreamEvent } from '../../apps/api/src/chat/chat.service.js';
import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createRequest,
  createSseReply,
  parseSseEvents,
  toAsyncIterable,
} from './chat-integration-test-utils.js';

describe('chat SSE format integration', () => {
  it('writes text/event-stream events in the required sequence', async () => {
    const service = {
      streamCompletion: vi.fn(() =>
        Promise.resolve(
          toAsyncIterable<ChatStreamEvent>([
            { type: 'session', session_id: 'session-1' },
            { type: 'content', delta: 'hello ' },
            { type: 'content', delta: 'world' },
            { type: 'citations', citations: [] },
            { type: 'usage', usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
          ]),
        ),
      ),
    } as unknown as ChatService;
    const controller = new ChatController(service);
    const reply = createSseReply();

    await controller.streamCompletion(
      { space_id: TEST_SPACE_ID, message: 'hello' },
      createRequest({ userId: TEST_USER_ID, tenantId: TEST_TENANT_ID }),
      reply,
    );

    const output = reply.output.join('');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers).toMatchObject({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    expect(parseSseEvents(output).map((event) => event.event ?? event.data)).toEqual([
      'session',
      'content',
      'content',
      'citations',
      'usage',
      '[DONE]',
    ]);
    expect(output).not.toContain('"data":');
    expect(output).toContain('data: [DONE]\n\n');
  });

  it('bypasses ResponseWrapperInterceptor for the chat completion stream route', async () => {
    const interceptor = new ResponseWrapperInterceptor();
    const context = createWrapperContext('/api/chat/completions');
    const rawStreamResult = { stream: true };
    const next: CallHandler = {
      handle: () => rawStreamResult as never,
    };

    expect(interceptor.intercept(context, next)).toBe(rawStreamResult);
  });
});

function createWrapperContext(url: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ url }),
    }),
  } as unknown as ExecutionContext;
}
