import { Module } from '@nestjs/common';

import { ModelConfigController, PublicModelConfigController } from './model-config.controller.js';
import { ModelConfigService } from './model-config.service.js';

@Module({
  controllers: [ModelConfigController, PublicModelConfigController],
  providers: [ModelConfigService],
  exports: [ModelConfigService],
})
export class ModelConfigModule {}
