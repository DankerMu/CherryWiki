import { Module } from '@nestjs/common';

import { ModelConfigModule } from '../models/model-config.module.js';
import { AdminHealthController } from './admin-health.controller.js';

@Module({
  imports: [ModelConfigModule],
  controllers: [AdminHealthController],
})
export class AdminHealthModule {}
