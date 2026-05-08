import { Injectable } from '@nestjs/common';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

import { isRecord, mapClaudeEvent, parseJsonLine } from './claude-event-mapper.js';
import type { AgentEvent } from './dto/agent.dto.js';

export type StreamParserOptions = {
  onSessionId?: (sessionId: string) => void;
  onFirstForwardedEvent?: () => void;
  onCompleted?: (event: Extract<AgentEvent, { type: 'message.completed' }>) => void;
};

@Injectable()
export class StreamParser {
  async *parse(stream: Readable, options: StreamParserOptions = {}): AsyncGenerator<AgentEvent> {
    const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    let firstForwardedEventSeen = false;

    for await (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      const parsed = parseJsonLine(trimmed);
      if (!isRecord(parsed)) {
        continue;
      }

      for (const event of mapClaudeEvent(parsed, options)) {
        if (!firstForwardedEventSeen) {
          firstForwardedEventSeen = true;
          options.onFirstForwardedEvent?.();
        }

        if (event.type === 'message.completed') {
          options.onCompleted?.(event);
        }

        yield event;
      }
    }
  }
}
