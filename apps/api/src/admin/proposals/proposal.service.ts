import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode, wikiPages, wikiUpdateProposals } from '@cherrygraph/shared';
import { and, count, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { throwApiError } from '../../common/errors/api-error.js';
import { getApiLogger } from '../../common/logger/logger.module.js';
import { DRIZZLE } from '../../database/drizzle.constants.js';

type ProposalRow = typeof wikiUpdateProposals.$inferSelect;
type ProposalStatus = 'pending' | 'accepted' | 'rejected';

export type ResolveProposalAction = 'accept' | 'reject';

export type ProposalSummary = {
  id: string;
  proposal_type: string;
  status: string;
  created_at: Date;
  wiki_page_pk: string | null;
  space_id: string;
};

export type ProposalDetail = ProposalSummary & {
  tenant_id: string;
  graphify_run_id: string | null;
  diff_json: unknown;
  resolved_at: Date | null;
};

export type ListProposalsResponse = {
  data: ProposalSummary[];
  total: number;
  page: number;
  limit: number;
};

export type ProposalListQuery = {
  status?: string;
  page?: string | number;
  limit?: string | number;
};

@Injectable()
export class ProposalService {
  constructor(@Inject(DRIZZLE) private readonly db: NodePgDatabase) {}

  async listProposals(query: ProposalListQuery = {}): Promise<ListProposalsResponse> {
    const page = normalizePositiveInt(query.page, 1);
    const limit = normalizePositiveInt(query.limit, 20, 100);
    const status = normalizeOptionalStatus(query.status);
    const where = status === undefined ? undefined : eq(wikiUpdateProposals.status, status);
    const rows = await this.db
      .select({
        id: wikiUpdateProposals.id,
        proposal_type: wikiUpdateProposals.proposal_type,
        status: wikiUpdateProposals.status,
        created_at: wikiUpdateProposals.created_at,
        wiki_page_pk: wikiUpdateProposals.wiki_page_pk,
        space_id: wikiUpdateProposals.space_id,
      })
      .from(wikiUpdateProposals)
      .where(where)
      .orderBy(desc(wikiUpdateProposals.created_at))
      .limit(limit)
      .offset((page - 1) * limit);
    const [countRow] = await this.db
      .select({ total: count() })
      .from(wikiUpdateProposals)
      .where(where);

    return {
      data: rows,
      total: Number(countRow?.total ?? 0),
      page,
      limit,
    };
  }

  async getProposal(id: string): Promise<ProposalDetail> {
    return toProposalDetail(await this.requireProposal(id));
  }

  async resolveProposal(id: string, action: ResolveProposalAction | undefined): Promise<ProposalDetail> {
    const normalizedAction = normalizeResolveAction(action);
    const proposal = await this.requireProposal(id);
    if (proposal.status !== 'pending') {
      throwApiError(ErrorCode.PROPOSAL_ALREADY_RESOLVED, 'Proposal is already resolved', HttpStatus.CONFLICT);
    }

    const status = normalizedAction === 'accept' ? 'accepted' : 'rejected';
    const resolvedAt = new Date();
    const [updated] = await this.db
      .update(wikiUpdateProposals)
      .set({ status, resolved_at: resolvedAt })
      .where(eq(wikiUpdateProposals.id, id))
      .returning();

    if (updated === undefined) {
      throwApiError(ErrorCode.NOT_FOUND, 'Proposal not found', HttpStatus.NOT_FOUND);
    }

    if (normalizedAction === 'accept') {
      getApiLogger().info(
        { proposal_id: id, wiki_page_pk: updated.wiki_page_pk },
        'proposal accepted, content replacement deferred',
      );
    } else {
      await this.markPageSyncedWhenNoPending(updated);
    }
    return toProposalDetail(updated);
  }

  private async requireProposal(id: string): Promise<ProposalRow> {
    const [proposal] = await this.db
      .select()
      .from(wikiUpdateProposals)
      .where(eq(wikiUpdateProposals.id, id))
      .limit(1);

    if (proposal === undefined) {
      throwApiError(ErrorCode.NOT_FOUND, 'Proposal not found', HttpStatus.NOT_FOUND);
    }

    return proposal;
  }

  private async markPageSyncedWhenNoPending(proposal: ProposalRow): Promise<void> {
    if (proposal.wiki_page_pk === null) {
      return;
    }

    const [pending] = await this.db
      .select({ id: wikiUpdateProposals.id })
      .from(wikiUpdateProposals)
      .where(
        and(
          eq(wikiUpdateProposals.wiki_page_pk, proposal.wiki_page_pk),
          eq(wikiUpdateProposals.status, 'pending'),
        ),
      )
      .limit(1);

    if (pending !== undefined) {
      return;
    }

    await this.db
      .update(wikiPages)
      .set({ sync_status: 'synced', updated_at: new Date() })
      .where(eq(wikiPages.id, proposal.wiki_page_pk));
  }
}

function toProposalDetail(row: ProposalRow): ProposalDetail {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    space_id: row.space_id,
    wiki_page_pk: row.wiki_page_pk,
    graphify_run_id: row.graphify_run_id,
    proposal_type: row.proposal_type,
    status: row.status,
    diff_json: row.diff_json,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
  };
}

function normalizePositiveInt(value: string | number | undefined, fallback: number, max = Number.POSITIVE_INFINITY): number {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeOptionalStatus(status: string | undefined): ProposalStatus | undefined {
  if (status === undefined || status.trim().length === 0) {
    return undefined;
  }

  if (status === 'pending' || status === 'accepted' || status === 'rejected') {
    return status;
  }

  throwApiError(ErrorCode.INVALID_PROPOSAL_STATUS, `Invalid proposal status: ${status}`, HttpStatus.BAD_REQUEST);
}

function normalizeResolveAction(action: ResolveProposalAction | undefined): ResolveProposalAction {
  if (action === 'accept' || action === 'reject') {
    return action;
  }

  throwApiError(ErrorCode.INVALID_PROPOSAL_ACTION, 'Action must be accept or reject', HttpStatus.BAD_REQUEST);
}
