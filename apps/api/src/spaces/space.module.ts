import { Module } from '@nestjs/common';

import { GroupModule } from '../groups/group.module.js';
import { SpaceController } from './space.controller.js';
import { SpacePermissionController } from './space-permission.controller.js';
import { SpaceService } from './space.service.js';

@Module({
  imports: [GroupModule],
  controllers: [SpaceController, SpacePermissionController],
  providers: [SpaceService],
  exports: [SpaceService],
})
export class SpaceModule {}
