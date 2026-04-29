import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AuditInterceptor } from './audit.interceptor.js';
import { AuditQueryController } from './audit-query.controller.js';
import { AuditService } from './audit.service.js';

@Global()
@Module({
  controllers: [AuditQueryController],
  providers: [
    AuditService,
    AuditInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useExisting: AuditInterceptor,
    },
  ],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
