import { Body, Controller, Get, Headers, HttpCode, HttpException, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';

import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { DiffQueryDto, PublishDto, RollbackDto, UnpublishDto, WikiListQueryDto } from './wiki.dto.js';
import { WikiService, type WikiAuditContext } from './wiki.service.js';

type RequestWithAuth = {
  user?: AuthenticatedRequestUser & {
    permissions?: string[];
  };
  permissions?: string[];
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  id?: string;
};

@Controller('spaces/:spaceId/wiki/pages')
export class WikiController {
  constructor(private readonly wikiService: WikiService) {}

  @Get()
  @Permissions('space:view')
  async listPages(
    @Param('spaceId') spaceId: string,
    @Query() query: WikiListQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<WikiService['listPages']> {
    const user = getAuthenticatedUser(request);
    return this.wikiService.listPages(user.tenant_id, spaceId, query);
  }

  @Get(':pageId')
  @Permissions('space:view')
  async getPage(
    @Param('spaceId') spaceId: string,
    @Param('pageId') pageId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<WikiService['getPage']> {
    const user = getAuthenticatedUser(request);
    return this.wikiService.getPage(user.tenant_id, spaceId, pageId);
  }

  @Get(':pageId/content')
  @Permissions('space:view')
  async getContent(
    @Param('spaceId') spaceId: string,
    @Param('pageId') pageId: string,
    @Query('version_id') versionId: string | undefined,
    @Req() request: RequestWithAuth,
  ): ReturnType<WikiService['getContent']> {
    const user = getAuthenticatedUser(request);
    return this.wikiService.getContent(user.tenant_id, spaceId, pageId, versionId);
  }

  @Get(':pageId/versions')
  @Permissions('space:view')
  async listVersions(
    @Param('spaceId') spaceId: string,
    @Param('pageId') pageId: string,
    @Query() query: PaginationQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<WikiService['listVersions']> {
    const user = getAuthenticatedUser(request);
    return this.wikiService.listVersions(user.tenant_id, spaceId, pageId, query);
  }

  @Get(':pageId/diff')
  @Permissions('space:view')
  async diffVersions(
    @Param('spaceId') spaceId: string,
    @Param('pageId') pageId: string,
    @Query() query: DiffQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<WikiService['diffVersions']> {
    const user = getAuthenticatedUser(request);
    return this.wikiService.diffVersions(user.tenant_id, spaceId, pageId, query.from_version_id, query.to_version_id);
  }

  @Post(':pageId/publish')
  @HttpCode(HttpStatus.OK)
  @Permissions('wiki:publish')
  async publish(
    @Param('spaceId') spaceId: string,
    @Param('pageId') pageId: string,
    @Body() body: PublishDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<WikiService['publish']> {
    const user = getAuthenticatedUser(request);
    return this.wikiService.publish(
      user.tenant_id,
      spaceId,
      pageId,
      body.version_id,
      body.publish_note,
      user.sub,
      buildAuditContext(request),
    );
  }

  @Post(':pageId/unpublish')
  @HttpCode(HttpStatus.OK)
  @Permissions('wiki:publish')
  async unpublish(
    @Param('spaceId') spaceId: string,
    @Param('pageId') pageId: string,
    @Body() body: UnpublishDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<WikiService['unpublish']> {
    const user = getAuthenticatedUser(request);
    return this.wikiService.unpublish(
      user.tenant_id,
      spaceId,
      pageId,
      body.version_id,
      body.reason,
      user.sub,
      buildAuditContext(request),
    );
  }

  @Post(':pageId/rollback')
  @HttpCode(HttpStatus.OK)
  @Permissions('wiki:rollback')
  async rollback(
    @Param('spaceId') spaceId: string,
    @Param('pageId') pageId: string,
    @Body() body: RollbackDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<WikiService['rollback']> {
    const user = getAuthenticatedUser(request);
    return this.wikiService.rollback(
      user.tenant_id,
      spaceId,
      pageId,
      body.target_version_id,
      body.reason,
      user.sub,
      buildAuditContext(request),
    );
  }

  @Post(':pageId/reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('wiki:publish')
  async reindexPage(
    @Param('spaceId') spaceId: string,
    @Param('pageId') pageId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Req() request: RequestWithAuth,
  ): Promise<{ data: Awaited<ReturnType<WikiService['reindexPage']>> }> {
    const user = getAuthenticatedUser(request);
    const data = await this.wikiService.reindexPage(
      user.tenant_id,
      spaceId,
      pageId,
      user.sub,
      idempotencyKey,
      buildAuditContext(request),
    );

    return { data };
  }
}

function getAuthenticatedUser(request: RequestWithAuth): AuthenticatedRequestUser & { permissions?: string[] } {
  if (request.user === undefined) {
    throw new HttpException(
      {
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Unauthenticated',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }

  return request.user;
}

function buildAuditContext(request: RequestWithAuth): WikiAuditContext {
  const userAgent = request.headers?.['user-agent'];
  const requestId = request.headers?.['x-request-id'];

  return {
    ...(request.ip !== undefined ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
    ...(typeof requestId === 'string' ? { requestId } : {}),
    ...(request.id !== undefined ? { requestId: request.id } : {}),
  };
}
