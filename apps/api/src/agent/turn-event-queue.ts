import type { AgentEvent } from './dto/agent.dto.js';

type PendingWait = {
  resolve: (event: AgentEvent | undefined) => void;
  reject: (err: Error) => void;
};

type SettlementWait = {
  resolve: () => void;
  reject: (err: Error) => void;
};

export class TurnEventQueue implements AsyncIterable<AgentEvent> {
  private readonly buffer: AgentEvent[] = [];
  private readonly settlementWaiters: SettlementWait[] = [];
  private pending: PendingWait | undefined = undefined;
  private done = false;
  private disposed = false;
  private failure: Error | undefined = undefined;
  private iterating = false;

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
    this.resolveSettlement();
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
    this.rejectSettlement(err);
  }

  [Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
    if (this.iterating) {
      throw new Error('TurnEventQueue supports only one concurrent consumer');
    }

    this.iterating = true;
    return this.iterate();
  }

  private async *iterate(): AsyncGenerator<AgentEvent> {
    try {
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
    } finally {
      this.iterating = false;
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
    this.resolveSettlement();
  }

  waitUntilSettled(): Promise<void> {
    if (this.done || this.disposed) {
      return Promise.resolve();
    }

    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }

    return new Promise((resolve, reject) => {
      this.settlementWaiters.push({ resolve, reject });
    });
  }

  private resolvePending(event: AgentEvent | undefined): void {
    const pending = this.pending;
    if (pending === undefined) {
      return;
    }

    this.pending = undefined;
    pending.resolve(event);
  }

  private resolveSettlement(): void {
    const waiters = this.settlementWaiters.splice(0);
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  private rejectSettlement(err: Error): void {
    const waiters = this.settlementWaiters.splice(0);
    for (const waiter of waiters) {
      waiter.reject(err);
    }
  }
}
