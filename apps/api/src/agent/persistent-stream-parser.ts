import { Injectable } from '@nestjs/common';
import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import type { Readable } from 'node:stream';

import { isRecord, mapClaudeEvent, parseJsonLine } from './claude-event-mapper.js';
import { TurnEventQueue } from './turn-event-queue.js';

export type PersistentParserCallbacks = {
  onSessionId?: (sessionId: string) => void;
};

@Injectable()
export class PersistentStreamParser {
  private activeTurn: TurnEventQueue | undefined = undefined;
  private lines: Interface | undefined = undefined;
  private stopped = false;

  startReading(stdout: Readable, callbacks: PersistentParserCallbacks = {}): void {
    this.stop();
    this.stopped = false;

    const lines = createInterface({ input: stdout, crlfDelay: Number.POSITIVE_INFINITY });
    this.lines = lines;

    void this.readLoop(lines, callbacks);
  }

  createTurn(): TurnEventQueue {
    if (this.activeTurn !== undefined) {
      throw new Error('A turn is already active for this persistent parser');
    }

    if (this.lines === undefined || this.stopped) {
      throw new Error('No active reader — call startReading() before creating a turn');
    }

    const queue = new TurnEventQueue();
    this.activeTurn = queue;
    return queue;
  }

  cancelActiveTurn(): void {
    const turn = this.activeTurn;
    if (turn === undefined) {
      return;
    }

    this.activeTurn = undefined;
    turn.dispose();
  }

  stop(): void {
    this.stopped = true;
    this.completeActiveTurn();
    this.lines?.close();
    this.lines = undefined;
  }

  private async readLoop(lines: Interface, callbacks: PersistentParserCallbacks): Promise<void> {
    try {
      for await (const line of lines) {
        if (this.stopped || this.lines !== lines) {
          return;
        }

        this.handleLine(line, callbacks);
      }

      if (this.lines === lines) {
        this.completeActiveTurn();
      }
    } catch (err) {
      if (this.lines === lines) {
        this.errorActiveTurn(toError(err));
      }
    } finally {
      if (this.lines === lines) {
        this.lines = undefined;
      }
    }
  }

  private handleLine(line: string, callbacks: PersistentParserCallbacks): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    const parsed = parseJsonLine(trimmed);
    if (!isRecord(parsed)) {
      return;
    }

    const isResult = parsed.type === 'result';
    for (const event of mapClaudeEvent(parsed, callbacks)) {
      this.activeTurn?.push(event);
    }

    if (isResult) {
      this.completeActiveTurn();
    }
  }

  private completeActiveTurn(): void {
    const turn = this.activeTurn;
    if (turn === undefined) {
      return;
    }

    this.activeTurn = undefined;
    turn.complete();
  }

  private errorActiveTurn(err: Error): void {
    const turn = this.activeTurn;
    if (turn === undefined) {
      return;
    }

    this.activeTurn = undefined;
    turn.error(err);
  }
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  return new Error(String(value));
}
