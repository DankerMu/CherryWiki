import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Public } from '@cherrygraph/auth-core';

import type { JobDto } from '../jobs/jobs.dto.js';
import { InternalJobsService } from './internal-jobs.service.js';
import { type JobFailureResponseDto, JobCompletionDto, JobFailureDto, JobProgressUpdateDto, PendingJobsQueryDto } from './internal.dto.js';
import { WorkerApiKeyGuard } from './worker-api-key.guard.js';

@Public()
@UseGuards(WorkerApiKeyGuard)
@Controller('internal/jobs')
export class InternalJobsController {
  constructor(private readonly internalJobsService: InternalJobsService) {}

  @Get('pending')
  async getPendingJobs(@Query() query: PendingJobsQueryDto): Promise<JobDto[]> {
    return this.internalJobsService.pollPendingJobs(query.type, query.limit);
  }

  @Patch(':job_id/progress')
  async reportProgress(
    @Param('job_id') jobId: string,
    @Body() body: JobProgressUpdateDto,
  ): Promise<JobDto> {
    return this.internalJobsService.reportProgress(jobId, body);
  }

  @Patch(':job_id/complete')
  async reportComplete(
    @Param('job_id') jobId: string,
    @Body() body: JobCompletionDto,
  ): Promise<JobDto> {
    return this.internalJobsService.reportComplete(jobId, body);
  }

  @Patch(':job_id/fail')
  async reportFailure(
    @Param('job_id') jobId: string,
    @Body() body: JobFailureDto,
  ): Promise<JobFailureResponseDto> {
    return this.internalJobsService.reportFailure(jobId, body);
  }
}
