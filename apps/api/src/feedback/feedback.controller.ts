import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { FeedbackService, type FeedbackAuditContext } from './feedback.service.js';

class FeedbackAdminListQueryDto {
  @IsOptional()
  @IsIn(['open', 'resolved'])
  status?: string;

  @IsOptional()
  @IsIn(['incorrect', 'missing', 'outdated', 'other', 'conflict'])
  feedback_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  space_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  user_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

type RequestWithAuth = {
  user?: AuthenticatedRequestUser;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  raw?: {
    ip?: string;
    headers?: Record<string, string | string[] | undefined>;
    request_id?: string;
    socket?: {
      remoteAddress?: string;
    };
  };
  socket?: {
    remoteAddress?: string;
  };
  request_id?: string;
  id?: string;
};

@Controller('spaces/:spaceId/feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @Permissions('space:read')
  async createFeedback(
    @Param('spaceId') spaceId: string,
    @Body() body: unknown,
    @Req() request: RequestWithAuth,
  ): ReturnType<FeedbackService['createFeedback']> {
    const user = getAuthenticatedUser(request);
    return this.feedbackService.createFeedback(body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      spaceId,
      audit: buildAuditContext(request),
    });
  }
}

@Controller('admin/feedback')
export class FeedbackAdminController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get()
  @Permissions('admin:user_manage')
  async listFeedback(
    @Query() query: FeedbackAdminListQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<FeedbackService['listFeedback']> {
    const user = getAuthenticatedUser(request);
    return this.feedbackService.listFeedback(query, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      audit: buildAuditContext(request),
    });
  }

  @Patch(':feedbackId/resolve')
  @Permissions('admin:user_manage')
  async resolveFeedback(
    @Param('feedbackId') feedbackId: string,
    @Body() body: unknown,
    @Req() request: RequestWithAuth,
  ): ReturnType<FeedbackService['resolveFeedback']> {
    const user = getAuthenticatedUser(request);
    return this.feedbackService.resolveFeedback(feedbackId, body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      audit: buildAuditContext(request),
    });
  }
}

function getAuthenticatedUser(request: RequestWithAuth): AuthenticatedRequestUser {
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

function buildAuditContext(request: RequestWithAuth): FeedbackAuditContext {
  const requestId = readSingleHeader(request, 'x-request-id') ?? request.request_id ?? request.raw?.request_id ?? request.id;
  const ip = request.ip ?? request.raw?.ip ?? request.socket?.remoteAddress ?? request.raw?.socket?.remoteAddress;
  const userAgent = readSingleHeader(request, 'user-agent');

  return {
    ...(ip !== undefined ? { ip } : {}),
    ...(userAgent !== undefined ? { userAgent } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

function readSingleHeader(request: RequestWithAuth, name: string): string | undefined {
  const value = request.headers?.[name] ?? request.raw?.headers?.[name];
  if (typeof value === 'string') {
    return value;
  }

  return Array.isArray(value) ? value[0] : undefined;
}
