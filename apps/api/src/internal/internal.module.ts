import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AuditModule } from '../audit/audit.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { InternalJobsController } from './internal-jobs.controller.js';
import { InternalJobsService } from './internal-jobs.service.js';
import { InternalWorkersController } from './internal-workers.controller.js';
import { WorkerApiKeyGuard } from './worker-api-key.guard.js';

@Module({
  imports: [ScheduleModule.forRoot(), UploadsModule, AuditModule],
  controllers: [InternalJobsController, InternalWorkersController],
  providers: [InternalJobsService, WorkerApiKeyGuard],
})
export class InternalModule {}
