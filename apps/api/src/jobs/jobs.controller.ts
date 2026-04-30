import { Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';

import {
  AdminJobListQueryDto,
  type CancelJobResponseDto,
  type JobDto,
  type JobEventDto,
  JobEventsQueryDto,
} from './jobs.dto.js';
import { JobsService, type JobContext } from './jobs.service.js';

type RequestWithAuth = {
  user?: AuthenticatedRequestUser & {
    permissions?: string[];
  };
  permissions?: string[];
};

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get(':job_id')
  async getJob(@Param('job_id') jobId: string, @Req() request: RequestWithAuth): Promise<JobDto> {
    const user = getAuthenticatedUser(request);
    return this.jobsService.getJob(jobId, buildJobContext(request, user));
  }

  @Get(':job_id/events')
  async getJobEvents(
    @Param('job_id') jobId: string,
    @Query() query: JobEventsQueryDto,
    @Req() request: RequestWithAuth,
  ): Promise<JobEventDto[]> {
    const user = getAuthenticatedUser(request);
    return this.jobsService.getJobEvents(jobId, buildJobContext(request, user), query);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':job_id/cancel')
  async cancelJob(
    @Param('job_id') jobId: string,
    @Req() request: RequestWithAuth,
  ): Promise<CancelJobResponseDto> {
    const user = getAuthenticatedUser(request);
    return this.jobsService.cancelJob(jobId, buildJobContext(request, user));
  }
}

@Permissions('admin:audit_view')
@Controller('admin/jobs')
export class AdminJobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  async listJobs(
    @Query() query: AdminJobListQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<JobsService['listAdminJobs']> {
    const user = getAuthenticatedUser(request);
    return this.jobsService.listAdminJobs(query, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      actorRole: user.role,
      userId: user.sub,
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

function buildJobContext(
  request: RequestWithAuth,
  user: AuthenticatedRequestUser & { permissions?: string[] },
): JobContext {
  const actorPermissions = request.permissions ?? user.permissions;

  return {
    tenantId: user.tenant_id,
    actorUserId: user.sub,
    actorRole: user.role,
    userId: user.sub,
    ...(actorPermissions !== undefined ? { actorPermissions } : {}),
  };
}
