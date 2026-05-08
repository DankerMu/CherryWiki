import type { AgentEvent } from './dto/agent.dto.js';

type PendingWait = {
  resolve: (event: AgentEvent | undefined) => void;
  reject: (err: Error) => void;
};

export class TurnEventQueue implements AsyncIterable<AgentEvent> {
  private readonly buffer: AgentEvent[] = [];
  private pending?: PendingWait;
  private done = false;
  private disposed = false;
  private failure?: Error;

  push(event: AgentEvent): void {
    if (this.done || this.disposed || this.failure !== undefined) {
      return;
    }

    const pending = this.pending;
    if (pending !== undefined) {
      this.pending = undefined;
      pending.resolve(event);
      return;
    }

    this.buffer.push(event);
  }

  complete(): void {
    if (this.done || this.disposed) {
      return;
    }

    this.done = true;
    this.resolvePending(undefined);
  }

  error(err: Error): void {
    if (this.done || this.disposed) {
      return;
    }

    this.failure = err;
    const pending = this.pending;
    if (pending !== undefined) {
      this.pending = undefined;
      pending.reject(err);
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
    while (true) {
      const buffered = this.buffer.shift();
      if (buffered !== undefined) {
        yield buffered;
        continue;
      }

      if (this.failure !== undefined) {
        throw this.failure;
      }

      if (this.done || this.disposed) {
        return;
      }

      const next = await new Promise<AgentEvent | undefined>((resolve, reject) => {
        this.pending = { resolve, reject };
      });

      if (next !== undefined) {
        yield next;
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.done = true;
    this.failure = undefined;
    this.buffer.length = 0;
    this.resolvePending(undefined);
  }

  private resolvePending(event: AgentEvent | undefined): void {
    const pending = this.pending;
    if (pending === undefined) {
      return;
    }

    this.pending = undefined;
    pending.resolve(event);
  }
}
