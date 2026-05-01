import { MiddlewareConsumer, Module, RequestMethod, type NestModule } from '@nestjs/common';

import { PinoHttpLoggerMiddleware, LoggerModule } from './common/logger/logger.module.js';
import { IdempotencyMiddleware } from './common/middleware/idempotency.middleware.js';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware.js';
import { RedisModule } from './common/redis/redis.module.js';
import { AdminHealthModule } from './admin/admin-health.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DrizzleModule } from './database/drizzle.module.js';
import { GroupModule } from './groups/group.module.js';
import { HealthModule } from './health/health.module.js';
import { InternalModule } from './internal/internal.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { ModelConfigModule } from './models/model-config.module.js';
import { SpaceModule } from './spaces/space.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { UserModule } from './users/user.module.js';

@Module({
  imports: [
    LoggerModule,
    RedisModule,
    DrizzleModule.forRoot({ connectionCheck: process.env.NODE_ENV !== 'test' }),
    AuditModule,
    AuthModule,
    UserModule,
    GroupModule,
    SpaceModule,
    JobsModule,
    InternalModule,
    ModelConfigModule,
    StorageModule,
    UploadsModule,
    HealthModule,
    AdminHealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware, PinoHttpLoggerMiddleware, IdempotencyMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
