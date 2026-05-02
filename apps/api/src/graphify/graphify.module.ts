import { Module } from '@nestjs/common';

import { GraphifyController } from './graphify.controller.js';
import { GraphifyService } from './graphify.service.js';

@Module({
  controllers: [GraphifyController],
  providers: [GraphifyService],
  exports: [GraphifyService],
})
export class GraphifyModule {}
