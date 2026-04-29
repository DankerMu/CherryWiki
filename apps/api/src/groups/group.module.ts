import { Module } from '@nestjs/common';

import { SpacePermissionController } from '../spaces/space-permission.controller.js';
import { GroupController } from './group.controller.js';
import { GroupService } from './group.service.js';

@Module({
  controllers: [GroupController, SpacePermissionController],
  providers: [GroupService],
  exports: [GroupService],
})
export class GroupModule {}
