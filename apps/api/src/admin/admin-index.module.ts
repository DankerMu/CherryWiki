import { Module } from '@nestjs/common';

import { AdminIndexController } from './admin-index.controller.js';
import { AdminIndexService } from './admin-index.service.js';

@Module({
  controllers: [AdminIndexController],
  providers: [AdminIndexService],
})
export class AdminIndexModule {}
