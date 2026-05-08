import { describe, expect, it } from 'vitest';

import type { DrizzleDatabase } from '../../database/drizzle.module.js';
import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  requireRecord,
} from '../../users/__tests__/user-group-service-test-utils.js';
import {
  AgentSessionRepository,
  type AgentSessionRow,
  type NewAgentSession,
} from '../agent-session.repository.js';

describe('AgentSessionRepository', () => {
  it('upserts a new agent session row', async () => {
    const db = new ScriptedAgentSessionDb();
    const repository = new AgentSessionRepository(db.asDrizzle());
    const row = createAgentSessionRow();
    db.queueInsert([row]);

    await expect(repository.upsert(createNewAgentSession())).resolves.toEqual(row);

    const inserted = requireRecord(db.inserts[0]?.value);
    expect(inserted).toMatchObject({
      conversation_id: 'conversation-1',
      tenant_id: TEST_TENANT_ID,
      provider: 'claude',
      status: 'idle',
    });
    expect(inserted.provider_session_id).toBeNull();
    expect(inserted.created_at).toBeInstanceOf(Date);
    expect(inserted.updated_at).toBeInstanceOf(Date);
  });

  it('updates an existing agent session on conversation id conflict', async () => {
    const db = new ScriptedAgentSessionDb();
    const repository = new AgentSessionRepository(db.asDrizzle());
    const updated = createAgentSessionRow({
      status: 'running',
      provider_session_id: 'claude-session-2',
    });
    db.queueInsert([updated]);

    await expect(
      repository.upsert(
        createNewAgentSession({
          status: 'running',
          provider_session_id: 'claude-session-2',
        }),
      ),
    ).resolves.toEqual(updated);

    const conflict = requireRecord(db.inserts[0]?.conflict);
    const set = requireRecord(conflict.set);
    expect(set).toMatchObject({
      status: 'running',
      provider_session_id: 'claude-session-2',
      tenant_id: TEST_TENANT_ID,
      space_id: TEST_SPACE_ID,
      user_id: TEST_USER_ID,
    });
    expect(set).not.toHaveProperty('created_at');
  });

  it('finds an agent session by conversation id or returns undefined', async () => {
    const db = new ScriptedAgentSessionDb();
    const repository = new AgentSessionRepository(db.asDrizzle());
    const row = createAgentSessionRow();
    db.queueSelect([row]);
    db.queueSelect([]);

    await expect(repository.findByConversationId('conversation-1')).resolves.toEqual(row);
    await expect(repository.findByConversationId('missing-conversation')).resolves.toBeUndefined();

    expect(db.selects).toHaveLength(2);
    expect(db.selects[0]?.limit).toBe(1);
  });

  it('updates the provider session id and updated timestamp', async () => {
    const db = new ScriptedAgentSessionDb();
    const repository = new AgentSessionRepository(db.asDrizzle());

    await repository.updateProviderSessionId('conversation-1', 'claude-session-1');

    const update = requireRecord(db.updates[0]?.value);
    expect(update.provider_session_id).toBe('claude-session-1');
    expect(update.updated_at).toBeInstanceOf(Date);
  });

  it('updates status with optional extra fields', async () => {
    const db = new ScriptedAgentSessionDb();
    const repository = new AgentSessionRepository(db.asDrizzle());
    const stoppedAt = new Date('2026-05-01T12:00:00.000Z');

    await repository.updateStatus('conversation-1', 'stopped', {
      conversation_id: 'other-conversation',
      created_at: new Date('2026-04-01T00:00:00.000Z'),
      process_stopped_at: stoppedAt,
      owned_by_instance: null,
    });

    const update = requireRecord(db.updates[0]?.value);
    expect(update.status).toBe('stopped');
    expect(update.process_stopped_at).toBe(stoppedAt);
    expect(update.owned_by_instance).toBeNull();
    expect(update.updated_at).toBeInstanceOf(Date);
    expect(update).not.toHaveProperty('conversation_id');
    expect(update).not.toHaveProperty('created_at');
  });

  it('updates the owning instance', async () => {
    const db = new ScriptedAgentSessionDb();
    const repository = new AgentSessionRepository(db.asDrizzle());

    await repository.updateOwnedByInstance('conversation-1', 'api-instance-1');

    const update = requireRecord(db.updates[0]?.value);
    expect(update.owned_by_instance).toBe('api-instance-1');
    expect(update.updated_at).toBeInstanceOf(Date);
  });

  it('touches activity and updated timestamps together', async () => {
    const db = new ScriptedAgentSessionDb();
    const repository = new AgentSessionRepository(db.asDrizzle());

    await repository.touchActivity('conversation-1');

    const update = requireRecord(db.updates[0]?.value);
    expect(update.last_activity_at).toBeInstanceOf(Date);
    expect(update.updated_at).toBe(update.last_activity_at);
  });

  it('deletes an agent session by conversation id', async () => {
    const db = new ScriptedAgentSessionDb();
    const repository = new AgentSessionRepository(db.asDrizzle());

    await repository.delete('conversation-1');

    expect(db.deletes).toHaveLength(1);
    expect(db.deletes[0]?.where).toHaveLength(1);
  });

  it('returns stale sessions for retention cleanup', async () => {
    const db = new ScriptedAgentSessionDb();
    const repository = new AgentSessionRepository(db.asDrizzle());
    const row = createAgentSessionRow({
      status: 'stopped',
      last_activity_at: new Date('2026-04-01T00:00:00.000Z'),
    });
    db.queueSelect([row]);

    await expect(
      repository.findStaleForRetentionCleanup(new Date('2026-05-01T00:00:00.000Z'), [
        'stopped',
        'failed',
      ]),
    ).resolves.toEqual([row]);

    expect(db.selects).toHaveLength(1);
    expect(db.selects[0]?.where).toHaveLength(1);
  });

  it('skips stale cleanup queries when no statuses are supplied', async () => {
    const db = new ScriptedAgentSessionDb();
    const repository = new AgentSessionRepository(db.asDrizzle());

    await expect(
      repository.findStaleForRetentionCleanup(new Date('2026-05-01T00:00:00.000Z'), []),
    ).resolves.toEqual([]);

    expect(db.selects).toHaveLength(0);
  });
});

function createNewAgentSession(overrides: Partial<NewAgentSession> = {}): NewAgentSession {
  return {
    conversation_id: 'conversation-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    user_id: TEST_USER_ID,
    provider: 'claude',
    provider_session_id: null,
    work_dir: '/tmp/cherry/agents/conversation-1/work',
    agent_home: '/tmp/cherry/agents/conversation-1/home',
    status: 'idle',
    options_hash: null,
    owned_by_instance: null,
    last_activity_at: new Date('2026-05-01T00:00:00.000Z'),
    process_started_at: null,
    process_stopped_at: null,
    ...overrides,
  };
}

function createAgentSessionRow(overrides: Partial<AgentSessionRow> = {}): AgentSessionRow {
  return {
    conversation_id: 'conversation-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    user_id: TEST_USER_ID,
    provider: 'claude',
    provider_session_id: null,
    work_dir: '/tmp/cherry/agents/conversation-1/work',
    agent_home: '/tmp/cherry/agents/conversation-1/home',
    status: 'idle',
    options_hash: null,
    owned_by_instance: null,
    last_activity_at: new Date('2026-05-01T00:00:00.000Z'),
    process_started_at: null,
    process_stopped_at: null,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

type OperationRecord = {
  table?: unknown;
  fields?: unknown;
  value?: unknown;
  where?: unknown[];
  limit?: number;
  conflict?: {
    target: unknown;
    set: unknown;
  };
};

class ScriptedAgentSessionDb {
  readonly selects: OperationRecord[] = [];
  readonly inserts: OperationRecord[] = [];
  readonly updates: OperationRecord[] = [];
  readonly deletes: OperationRecord[] = [];
  readonly selectResults: unknown[][] = [];
  readonly insertResults: unknown[][] = [];

  asDrizzle(): DrizzleDatabase {
    return this as unknown as DrizzleDatabase;
  }

  queueSelect(result: unknown[]): void {
    this.selectResults.push(result);
  }

  queueInsert(result: unknown[]): void {
    this.insertResults.push(result);
  }

  select(fields?: unknown): ScriptedSelectBuilder {
    const operation: OperationRecord = { fields };
    this.selects.push(operation);
    return new ScriptedSelectBuilder(this.selectResults.shift() ?? [], operation);
  }

  insert(table?: unknown): { values: (value: unknown) => ScriptedInsertBuilder } {
    const operation: OperationRecord = { table };
    this.inserts.push(operation);

    return {
      values: (value: unknown) => {
        operation.value = value;
        return new ScriptedInsertBuilder(this.insertResults.shift() ?? [], operation);
      },
    };
  }

  update(table?: unknown): { set: (value: unknown) => ScriptedUpdateBuilder } {
    const operation: OperationRecord = { table };
    this.updates.push(operation);

    return {
      set: (value: unknown) => {
        operation.value = value;
        return new ScriptedUpdateBuilder(operation);
      },
    };
  }

  delete(table?: unknown): ScriptedDeleteBuilder {
    const operation: OperationRecord = { table };
    this.deletes.push(operation);
    return new ScriptedDeleteBuilder(operation);
  }
}

class ScriptedSelectBuilder implements PromiseLike<unknown[]> {
  constructor(
    private readonly result: unknown[],
    private readonly operation: OperationRecord,
  ) {}

  from(table?: unknown): this {
    this.operation.table = table;
    return this;
  }

  where(condition: unknown): this {
    this.operation.where = [...(this.operation.where ?? []), condition];
    return this;
  }

  limit(value: number): this {
    this.operation.limit = value;
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

  onConflictDoUpdate(config: { target: unknown; set: unknown }): this {
    this.operation.conflict = config;
    return this;
  }

  returning(): Promise<unknown[]> {
    return Promise.resolve(this.result);
  }
}

class ScriptedUpdateBuilder implements PromiseLike<unknown[]> {
  constructor(private readonly operation: OperationRecord) {}

  where(condition: unknown): this {
    this.operation.where = [...(this.operation.where ?? []), condition];
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve([]).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class ScriptedDeleteBuilder implements PromiseLike<unknown[]> {
  constructor(private readonly operation: OperationRecord) {}

  where(condition: unknown): this {
    this.operation.where = [...(this.operation.where ?? []), condition];
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve([]).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}
