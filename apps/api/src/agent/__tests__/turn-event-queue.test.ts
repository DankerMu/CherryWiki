import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import type { AgentEvent } from '../dto/agent.dto.js';
import { TurnEventQueue } from '../turn-event-queue.js';
import { collectAsync } from './agent-test-utils.js';

void vi;

describe('TurnEventQueue', () => {
  it('delivers events pushed before the consumer starts iterating', async () => {
    const queue = new TurnEventQueue();
    queue.push(delta('buffered'));
    queue.complete();

    await expect(collectAsync(queue)).resolves.toEqual([delta('buffered')]);
  });

  it('resolves a waiting consumer immediately when an event is pushed', async () => {
    const queue = new TurnEventQueue();
    const iterator = queue[Symbol.asyncIterator]();
    const next = iterator.next();

    queue.push(delta('live'));

    await expect(next).resolves.toEqual({ value: delta('live'), done: false });
    queue.dispose();
  });

  it('ends iteration when complete is called', async () => {
    const queue = new TurnEventQueue();
    const iterator = queue[Symbol.asyncIterator]();

    queue.complete();

    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it('rejects a pending wait when error is called', async () => {
    const queue = new TurnEventQueue();
    const iterator = queue[Symbol.asyncIterator]();
    const next = iterator.next();

    queue.error(new Error('stream failed'));

    await expect(next).rejects.toThrow('stream failed');
  });

  it('delivers buffered events before throwing on error', async () => {
    const queue = new TurnEventQueue();
    queue.push(delta('first'));
    queue.error(new Error('late failure'));

    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: delta('first'), done: false });
    await expect(iterator.next()).rejects.toThrow('late failure');
  });

  it('ignores pushes after complete without throwing', async () => {
    const queue = new TurnEventQueue();

    queue.complete();
    expect(() => queue.push(delta('late'))).not.toThrow();

    await expect(collectAsync(queue)).resolves.toEqual([]);
  });

  it('delivers multiple events in sequence', async () => {
    const queue = new TurnEventQueue();
    const events = [delta('one'), toolUse('Bash'), delta('two')];

    for (const event of events) {
      queue.push(event);
    }
    queue.complete();

    await expect(collectAsync(queue)).resolves.toEqual(events);
  });

  it('rejects concurrent consumers', () => {
    const queue = new TurnEventQueue();
    void queue[Symbol.asyncIterator]();
    expect(() => queue[Symbol.asyncIterator]()).toThrow('only one concurrent consumer');
    queue.dispose();
  });

  it('cleans up pending consumers and buffered events on dispose', async () => {
    const queue = new TurnEventQueue();
    queue.push(delta('discarded'));
    const iterator = queue[Symbol.asyncIterator]();

    queue.dispose();
    queue.push(delta('ignored'));

    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    await expect(collectAsync(queue)).resolves.toEqual([]);
  });
});

function delta(text: string): AgentEvent {
  return { type: 'message.delta', delta: text };
}

function toolUse(name: string): AgentEvent {
  return { type: 'agent.tool_use', name, input: { command: 'echo ok' } };
}
