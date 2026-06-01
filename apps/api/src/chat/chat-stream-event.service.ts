import { Injectable } from '@nestjs/common';

import type { DatabaseMode } from './chat-routing.service.js';
import type { ChatStreamEvent, ChatUsage, CitationResponse } from './chat-events.js';

@Injectable()
export class ChatStreamEventService {
  session(sessionId: string): ChatStreamEvent {
    return { type: 'session', session_id: sessionId };
  }

  content(delta: string): ChatStreamEvent {
    return { type: 'content', delta };
  }

  citations(citations: CitationResponse[]): ChatStreamEvent {
    return { type: 'citations', citations };
  }

  usage(usage: ChatUsage): ChatStreamEvent {
    return { type: 'usage', usage };
  }

  agentToolUse(input: { id?: string; name: string; input: Record<string, unknown> }): ChatStreamEvent {
    const event: ChatStreamEvent = {
      type: 'agent.tool_use',
      name: input.name,
      input: input.input,
    };

    if (input.id !== undefined) {
      event.id = input.id;
    }

    return event;
  }

  chartData(data: Record<string, unknown>): ChatStreamEvent {
    return { type: 'chart.data', data };
  }

  messageCompleted(databaseMode?: DatabaseMode): ChatStreamEvent {
    return databaseMode === undefined
      ? { type: 'message.completed' }
      : { type: 'message.completed', database_mode: databaseMode };
  }

  error(code: string, message: string): ChatStreamEvent {
    return { type: 'error', code, message };
  }
}
