import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { FeedbackModule } from '../feedback/feedback.module.js';
import { GovernanceController } from './governance.controller.js';
import { GovernanceService } from './governance.service.js';

@Module({
  imports: [AuditModule, FeedbackModule],
  controllers: [GovernanceController],
  providers: [GovernanceService],
  exports: [GovernanceService],
})
export class GovernanceModule {}
