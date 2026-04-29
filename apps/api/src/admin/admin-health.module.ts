import { Module } from '@nestjs/common';

import { AdminHealthController } from './admin-health.controller.js';

@Module({
  controllers: [AdminHealthController],
})
export class AdminHealthModule {}
