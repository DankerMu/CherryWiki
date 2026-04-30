import { vi } from 'vitest';

import type { RedisJobLockClient } from '../lock.js';
import type { JobDatabase } from '../repository.js';
import { JobStatus } from '../status.js';
import type { JobEventRow, JobRow } from '../schema.js';

export type OperationRecord = {
  table?: unknown;
  fields?: unknown;
  value?: unknown;
  where?: unknown[];
  orderBy?: unknown[];
  limit?: number;
  offset?: number;
  conflictTarget?: unknown;
};

export class ScriptedDb {
  readonly selectOperations: OperationRecord[] = [];
  readonly insertOperations: OperationRecord[] = [];
  readonly updateOperations: OperationRecord[] = [];
  readonly selectResults: unknown[][] = [];
  readonly insertResults: unknown[][] = [];
  readonly updateResults: unknown[][] = [];

  queueSelect(result: unknown[]): void {
    this.selectResults.push(result);
  }

  queueInsert(result: unknown[]): void {
    this.insertResults.push(result);
  }

  queueUpdate(result: unknown[]): void {
    this.updateResults.push(result);
  }

  select(fields?: unknown): ScriptedQueryBuilder {
    const operation: OperationRecord = { fields };
    this.selectOperations.push(operation);
    return new ScriptedQueryBuilder(this.selectResults.shift() ?? [], operation);
  }

  insert(table?: unknown): { values: (value: unknown) => ScriptedInsertBuilder } {
    const operation: OperationRecord = { table };
    this.insertOperations.push(operation);

    return {
      values: (value: unknown) => {
        operation.value = value;
        return new ScriptedInsertBuilder(this.insertResults.shift() ?? [], operation);
      },
    };
  }

  update(table?: unknown): { set: (value: unknown) => ScriptedUpdateBuilder } {
    const operation: OperationRecord = { table };
    this.updateOperations.push(operation);

    return {
      set: (value: unknown) => {
        operation.value = value;
        return new ScriptedUpdateBuilder(this.updateResults.shift() ?? [], operation);
      },
    };
  }

  asDb(): JobDatabase {
    return this as unknown as JobDatabase;
  }
}

class ScriptedQueryBuilder implements PromiseLike<unknown[]> {
  constructor(
    private readonly result: unknown[],
    private readonly operation: OperationRecord,
  ) {}

  from(table?: unknown): this {
    this.operation.table = table;
    return this;
  }

  $dynamic(): this {
    return this;
  }

  where(condition: unknown): this {
    this.operation.where = [...(this.operation.where ?? []), condition];
    return this;
  }

  orderBy(...clauses: unknown[]): this {
    this.operation.orderBy = clauses;
    return this;
  }

  limit(value: number): this {
    this.operation.limit = value;
    return this;
  }

  offset(value: number): this {
    this.operation.offset = value;
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class ScriptedInsertBuilder {
  constructor(
    private readonly result: unknown[],
    private readonly operation: OperationRecord,
  ) {}

  onConflictDoNothing(config: { target: unknown }): this {
    this.operation.conflictTarget = config.target;
    return this;
  }

  returning(): Promise<unknown[]> {
    return Promise.resolve(this.result);
  }
}

class ScriptedUpdateBuilder {
  constructor(
    private readonly result: unknown[],
    private readonly operation: OperationRecord,
  ) {}

  where(condition: unknown): this {
    this.operation.where = [...(this.operation.where ?? []), condition];
    return this;
  }

  returning(): Promise<unknown[]> {
    return Promise.resolve(this.result);
  }
}

export class RedisMock implements RedisJobLockClient {
  private readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null> {
    const ttlIndex = args.findIndex((entry) => entry === 'EX');
    if (ttlIndex === -1 || typeof args[ttlIndex + 1] !== 'number') {
      throw new Error('RedisMock only supports SET ... EX <ttl> [NX|XX]');
    }

    const mode = args.find((entry) => entry === 'NX' || entry === 'XX');

    if (mode === 'NX' && this.values.has(key)) {
      return Promise.resolve(null);
    }

    if (mode === 'XX' && !this.values.has(key)) {
      return Promise.resolve(null);
    }

    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  eval(script: string, _numKeys: number, ...args: Array<string | number>): Promise<number> {
    const [key, workerId] = args;
    if (typeof key !== 'string' || typeof workerId !== 'string') {
      return Promise.reject(new Error('RedisMock eval requires string key and worker id'));
    }

    if (
      script ===
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"
    ) {
      if (this.values.get(key) === workerId) {
        this.values.delete(key);
        return Promise.resolve(1);
      }

      return Promise.resolve(0);
    }

    return Promise.reject(new Error(`Unsupported script: ${script}`));
  }

  seed(key: string, value: string): void {
    this.values.set(key, value);
  }

  has(key: string): boolean {
    return this.values.has(key);
  }
}

export function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    queue_name: 'ingestion',
    type: 'graphify',
    priority: 100,
    status: JobStatus.PENDING,
    attempt_count: 0,
    max_attempts: 3,
    timeout_seconds: 600,
    locked_by: null,
    locked_at: null,
    next_run_at: null,
    cancel_requested_at: null,
    payload_json: {},
    result_json: null,
    error_json: null,
    idempotency_key: null,
    created_by: 'user-1',
    created_at: new Date('2026-04-01T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

export function createJobEventRow(overrides: Partial<JobEventRow> = {}): JobEventRow {
  return {
    id: 'event-1',
    job_id: 'job-1',
    event_type: 'status_changed',
    detail_json: {},
    created_at: new Date('2026-04-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function createReleaseSpy() {
  return vi.fn<(...args: unknown[]) => Promise<boolean>>(() => Promise.resolve(true));
}
