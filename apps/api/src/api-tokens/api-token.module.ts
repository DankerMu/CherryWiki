import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';

import { AuditModule } from '../audit/audit.module.js';
import { ApiTokenAdminController } from './api-token.controller.js';
import { ApiTokenGuard } from './api-token.guard.js';
import { ApiTokenService } from './api-token.service.js';

@Module({
  imports: [AuditModule],
  controllers: [ApiTokenAdminController],
  providers: [
    ApiTokenService,
    ApiTokenGuard,
    Reflector,
    {
      provide: APP_GUARD,
      useExisting: ApiTokenGuard,
    },
  ],
  exports: [ApiTokenService, ApiTokenGuard],
})
export class ApiTokenModule {}
