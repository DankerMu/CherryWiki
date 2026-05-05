import { HttpException } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';

import { wikiPages, wikiUpdateProposals } from '@cherrygraph/shared';

import { ProposalController } from '../proposals/proposal.controller.js';
import { ProposalService } from '../proposals/proposal.service.js';

describe('ProposalController', () => {
  it('lists proposals with pagination', async () => {
    const db = new ScriptedProposalDb();
    db.queueSelect([createProposal({ id: 'proposal-2' }), createProposal({ id: 'proposal-1' })]);
    db.queueSelect([{ total: 2 }]);
    const { controller } = createController(db);

    const result = await controller.listProposals({ page: '2', limit: '20' });

    expect(result).toMatchObject({
      total: 2,
      page: 2,
      limit: 20,
    });
    expect(result.data.map((proposal) => proposal.id)).toEqual(['proposal-2', 'proposal-1']);
    expect(db.offsets).toEqual([20]);
  });

  it('filters proposals by status', async () => {
    const db = new ScriptedProposalDb();
    db.queueSelect([createProposal({ status: 'accepted' })]);
    db.queueSelect([{ total: 1 }]);
    const { controller } = createController(db);

    const result = await controller.listProposals({ status: 'accepted' });

    expect(result.total).toBe(1);
    expect(result.data[0]?.status).toBe('accepted');
  });

  it('returns proposal detail with diff_json', async () => {
    const db = new ScriptedProposalDb();
    db.queueSelect([createProposal({ diff_json: { blockId: 'overview', humanContent: 'Human', graphifyContent: 'Graphify' } })]);
    const { controller } = createController(db);

    const result = await controller.getProposal('proposal-1');

    expect(result).toMatchObject({
      id: 'proposal-1',
      diff_json: { blockId: 'overview', humanContent: 'Human', graphifyContent: 'Graphify' },
    });
  });

  it('accepts a pending proposal without clearing sync status (content replacement deferred)', async () => {
    const db = new ScriptedProposalDb();
    db.queueSelect([createProposal()]);
    db.queueUpdateReturning(createProposal({ status: 'accepted', resolved_at: new Date('2026-05-05T13:00:00.000Z') }));
    const { controller } = createController(db);

    const result = await controller.resolveProposal('proposal-1', { action: 'accept' });

    expect(result.status).toBe('accepted');
    expect(db.proposalUpdates[0]).toMatchObject({ status: 'accepted' });
    expect(db.pageUpdates).toHaveLength(0);
  });

  it('rejects a pending proposal and clears sync status when no pending proposals remain', async () => {
    const db = new ScriptedProposalDb();
    db.queueSelect([createProposal()]);
    db.queueUpdateReturning(createProposal({ status: 'rejected', resolved_at: new Date('2026-05-05T13:00:00.000Z') }));
    db.queueSelect([]);
    const { controller } = createController(db);

    const result = await controller.resolveProposal('proposal-1', { action: 'reject' });

    expect(result.status).toBe('rejected');
    expect(db.proposalUpdates[0]).toMatchObject({ status: 'rejected' });
    expect(db.pageUpdates[0]).toMatchObject({ sync_status: 'synced' });
  });

  it('returns 409 when resolving an already-resolved proposal', async () => {
    const db = new ScriptedProposalDb();
    db.queueSelect([createProposal({ status: 'accepted' })]);
    const { controller } = createController(db);

    const err = await getRejectedHttpException(controller.resolveProposal('proposal-1', { action: 'reject' }));

    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: 'PROPOSAL_ALREADY_RESOLVED' });
    expect(db.proposalUpdates).toHaveLength(0);
  });

  it('returns 404 when proposal is not found', async () => {
    const db = new ScriptedProposalDb();
    db.queueSelect([]);
    const { controller } = createController(db);

    const err = await getRejectedHttpException(controller.getProposal('missing-proposal'));

    expect(err.getStatus()).toBe(404);
  });
});

type ProposalRow = typeof wikiUpdateProposals.$inferSelect;

class ScriptedProposalDb {
  readonly selectResults: unknown[][] = [];
  readonly updateReturningResults: unknown[][] = [];
  readonly proposalUpdates: Array<Partial<typeof wikiUpdateProposals.$inferInsert>> = [];
  readonly pageUpdates: Array<Partial<typeof wikiPages.$inferInsert>> = [];
  readonly offsets: number[] = [];

  asDrizzle(): NodePgDatabase {
    return this as unknown as NodePgDatabase;
  }

  queueSelect(result: unknown[]): void {
    this.selectResults.push(result);
  }

  queueUpdateReturning(row: unknown): void {
    this.updateReturningResults.push([row]);
  }

  select(): ScriptedSelectBuilder {
    return new ScriptedSelectBuilder(this, this.selectResults.shift() ?? []);
  }

  update(table: unknown): ScriptedUpdateBuilder {
    return new ScriptedUpdateBuilder(this, table);
  }
}

class ScriptedSelectBuilder implements PromiseLike<unknown[]> {
  constructor(
    private readonly db: ScriptedProposalDb,
    private readonly result: unknown[],
  ) {}

  from(): this {
    return this;
  }

  where(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  offset(offset: number): Promise<unknown[]> {
    this.db.offsets.push(offset);
    return Promise.resolve(this.result);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class ScriptedUpdateBuilder {
  constructor(
    private readonly db: ScriptedProposalDb,
    private readonly table: unknown,
  ) {}

  set(values: Record<string, unknown>): { where: () => ScriptedUpdateWhereBuilder } {
    return {
      where: () => new ScriptedUpdateWhereBuilder(this.db, this.table, values),
    };
  }
}

class ScriptedUpdateWhereBuilder implements PromiseLike<void> {
  private applied = false;

  constructor(
    private readonly db: ScriptedProposalDb,
    private readonly table: unknown,
    private readonly values: Record<string, unknown>,
  ) {}

  returning(): Promise<unknown[]> {
    this.applyUpdate();
    return Promise.resolve(this.db.updateReturningResults.shift() ?? []);
  }

  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.applyUpdate();
    return Promise.resolve(undefined).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private applyUpdate(): void {
    if (this.applied) {
      return;
    }
    this.applied = true;

    if (this.table === wikiUpdateProposals) {
      this.db.proposalUpdates.push(this.values);
    }
    if (this.table === wikiPages) {
      this.db.pageUpdates.push(this.values);
    }
  }
}

function createController(db: ScriptedProposalDb): {
  controller: ProposalController;
  service: ProposalService;
} {
  const service = new ProposalService(db.asDrizzle());

  return {
    controller: new ProposalController(service),
    service,
  };
}

function createProposal(overrides: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: 'proposal-1',
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    wiki_page_pk: 'wiki-pk-1',
    graphify_run_id: 'run-1',
    proposal_type: 'conflict',
    status: 'pending',
    diff_json: {
      blockId: 'overview',
      humanContent: '## Overview\nHuman',
      graphifyContent: '## Overview\nGraphify',
    },
    created_at: new Date('2026-05-05T12:00:00.000Z'),
    resolved_at: null,
    ...overrides,
  };
}

async function getRejectedHttpException(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpException) {
      return err;
    }
    throw err;
  }

  throw new Error('Expected promise to reject');
}
