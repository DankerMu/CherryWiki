import { Module } from '@nestjs/common';

import { AdminWorkersController } from './admin-workers.controller.js';

@Module({
  controllers: [AdminWorkersController],
})
export class AdminWorkersModule {}
