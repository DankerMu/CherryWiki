import { Module } from '@nestjs/common';

import { BridgeModule } from '../bridge/bridge.module.js';
import { GroupController } from './group.controller.js';
import { GroupService } from './group.service.js';

@Module({
  imports: [BridgeModule],
  controllers: [GroupController],
  providers: [GroupService],
  exports: [GroupService],
})
export class GroupModule {}
