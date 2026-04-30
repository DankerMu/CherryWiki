import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Public } from '@cherrygraph/auth-core';

import { InternalJobsService } from './internal-jobs.service.js';
import { type WorkerHeartbeatResponseDto, WorkerHeartbeatDto } from './internal.dto.js';
import { WorkerApiKeyGuard } from './worker-api-key.guard.js';

@Public()
@UseGuards(WorkerApiKeyGuard)
@Controller('internal/workers')
export class InternalWorkersController {
  constructor(private readonly internalJobsService: InternalJobsService) {}

  @HttpCode(HttpStatus.OK)
  @Post('heartbeat')
  async recordHeartbeat(@Body() body: WorkerHeartbeatDto): Promise<WorkerHeartbeatResponseDto> {
    return this.internalJobsService.recordHeartbeat(body);
  }
}
