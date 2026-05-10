import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AuditModule } from '../audit/audit.module.js';
import { BridgeModule } from '../bridge/bridge.module.js';
import { GraphifyModule } from '../graphify/graphify.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { InternalJobsController } from './internal-jobs.controller.js';
import { InternalJobsService } from './internal-jobs.service.js';
import { InternalWikiController } from './internal-wiki.controller.js';
import { InternalWorkersController } from './internal-workers.controller.js';
import { AgentTokenGuard } from './agent-token.guard.js';
import { WorkerApiKeyGuard } from './worker-api-key.guard.js';

@Module({
  imports: [ScheduleModule.forRoot(), UploadsModule, AuditModule, GraphifyModule, BridgeModule],
  controllers: [InternalJobsController, InternalWorkersController, InternalWikiController],
  providers: [InternalJobsService, WorkerApiKeyGuard, AgentTokenGuard],
})
export class InternalModule {}
