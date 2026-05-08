import 'reflect-metadata';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PersistentStreamParser } from '../persistent-stream-parser.js';
import { collectAsync, createMockProcess, writeJsonLine } from './agent-test-utils.js';

const parsers: PersistentStreamParser[] = [];

afterEach(() => {
  for (const parser of parsers.splice(0)) {
    parser.stop();
  }
});

describe('PersistentStreamParser', () => {
  it('streams a single turn and completes on result', async () => {
    const proc = createMockProcess();
    const parser = createParser();
    parser.startReading(proc.stdout);
    const turn = parser.createTurn();
    const events = collectAsync(turn);

    writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: 'session-1' });
    writeJsonLine(proc, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello' }] },
    });
    writeJsonLine(proc, {
      type: 'result',
      subtype: 'success',
      session_id: 'session-1',
      result: 'done',
      usage: { input_tokens: 2, output_tokens: 3 },
    });

    await expect(events).resolves.toEqual([
      { type: 'message.delta', delta: 'hello' },
      {
        type: 'message.completed',
        session_id: 'session-1',
        result: 'done',
        usage: { input_tokens: 2, output_tokens: 3 },
      },
    ]);
  });

  it('continues reading for a second turn on the same stream after the first result', async () => {
    const proc = createMockProcess();
    const parser = createParser();
    parser.startReading(proc.stdout);

    const firstTurn = parser.createTurn();
    const firstEvents = collectAsync(firstTurn);
    writeJsonLine(proc, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'first' }] },
    });
    writeJsonLine(proc, { type: 'result', subtype: 'success', session_id: 'session-1' });
    await expect(firstEvents).resolves.toEqual([
      { type: 'message.delta', delta: 'first' },
      { type: 'message.completed', session_id: 'session-1' },
    ]);

    const secondTurn = parser.createTurn();
    const secondEvents = collectAsync(secondTurn);
    writeJsonLine(proc, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'second' }] },
    });
    writeJsonLine(proc, { type: 'result', subtype: 'success', session_id: 'session-2' });

    await expect(secondEvents).resolves.toEqual([
      { type: 'message.delta', delta: 'second' },
      { type: 'message.completed', session_id: 'session-2' },
    ]);
  });

  it('captures system init session ids without dispatching system events to the turn queue', async () => {
    const proc = createMockProcess();
    const parser = createParser();
    const onSessionId = vi.fn();
    parser.startReading(proc.stdout, { onSessionId });
    const turn = parser.createTurn();
    const events = collectAsync(turn);

    writeJsonLine(proc, { type: 'system', subtype: 'init', session_id: 'session-init' });
    writeJsonLine(proc, { type: 'result', subtype: 'success' });

    await expect(events).resolves.toEqual([{ type: 'message.completed' }]);
    expect(onSessionId).toHaveBeenCalledTimes(1);
    expect(onSessionId).toHaveBeenCalledWith('session-init');
  });

  it('pushes the mapped result event before completing the turn queue', async () => {
    const proc = createMockProcess();
    const parser = createParser();
    parser.startReading(proc.stdout);
    const turn = parser.createTurn();
    const iterator = turn[Symbol.asyncIterator]();

    writeJsonLine(proc, {
      type: 'result',
      subtype: 'success',
      session_id: 'session-result',
      total_cost_usd: 0.01,
    });

    await expect(iterator.next()).resolves.toEqual({
      value: { type: 'message.completed', session_id: 'session-result', total_cost_usd: 0.01 },
      done: false,
    });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it('completes the active turn when stdout closes', async () => {
    const proc = createMockProcess();
    const parser = createParser();
    parser.startReading(proc.stdout);
    const turn = parser.createTurn();
    const events = collectAsync(turn);

    proc.stdout.end();

    await expect(events).resolves.toEqual([]);
  });

  it('throws when creating a turn while another turn is active', () => {
    const proc = createMockProcess();
    const parser = createParser();
    parser.startReading(proc.stdout);
    parser.createTurn();

    expect(() => parser.createTurn()).toThrow('A turn is already active');
  });

  it('forwards result error events to the turn queue', async () => {
    const proc = createMockProcess();
    const parser = createParser();
    parser.startReading(proc.stdout);
    const turn = parser.createTurn();
    const events = collectAsync(turn);

    writeJsonLine(proc, {
      type: 'result',
      subtype: 'error_during_execution',
      error: 'tool failed',
    });

    await expect(events).resolves.toEqual([
      { type: 'message.error', code: 'error_during_execution', message: 'tool failed' },
    ]);
  });
});

function createParser(): PersistentStreamParser {
  const parser = new PersistentStreamParser();
  parsers.push(parser);
  return parser;
}
