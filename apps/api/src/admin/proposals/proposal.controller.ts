import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Permissions } from '@cherrygraph/auth-core';

import {
  ProposalService,
  type ListProposalsResponse,
  type ProposalDetail,
  type ProposalListQuery,
  type ResolveProposalAction,
} from './proposal.service.js';

@Permissions('admin')
@Controller('admin/proposals')
export class ProposalController {
  constructor(private readonly proposalService: ProposalService) {}

  @Get()
  async listProposals(@Query() query: ProposalListQuery): Promise<ListProposalsResponse> {
    return this.proposalService.listProposals(query);
  }

  @Get(':id')
  async getProposal(@Param('id') id: string): Promise<ProposalDetail> {
    return this.proposalService.getProposal(id);
  }

  @Post(':id/resolve')
  async resolveProposal(
    @Param('id') id: string,
    @Body() body: { action?: ResolveProposalAction },
  ): Promise<ProposalDetail> {
    return this.proposalService.resolveProposal(id, body?.action);
  }
}
