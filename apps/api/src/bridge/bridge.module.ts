import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { BridgeAuthGuard } from './bridge-auth.guard.js';
import { BridgeEventController } from './bridge-event.controller.js';
import { BridgeEventService } from './bridge-event.service.js';
import { BridgeRateLimitGuard } from './bridge-rate-limit.guard.js';

@Module({
  imports: [AuditModule],
  controllers: [BridgeEventController],
  providers: [BridgeAuthGuard, BridgeRateLimitGuard, BridgeEventService],
})
export class BridgeModule {}
