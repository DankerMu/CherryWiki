import { MiddlewareConsumer, Module, RequestMethod, type NestModule } from '@nestjs/common';

import { PinoHttpLoggerMiddleware, LoggerModule } from './common/logger/logger.module.js';
import { IdempotencyMiddleware } from './common/middleware/idempotency.middleware.js';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware.js';
import { RedisModule } from './common/redis/redis.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DrizzleModule } from './database/drizzle.module.js';
import { GroupModule } from './groups/group.module.js';
import { HealthModule } from './health/health.module.js';
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
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware, PinoHttpLoggerMiddleware, IdempotencyMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
